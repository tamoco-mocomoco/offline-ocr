/**
 * Viewer page: open a local image file, select a region, and run OCR.
 *
 * This page runs as a chrome-extension:// page, so it can directly
 * communicate with the background service worker and offscreen document.
 * No content script injection is needed.
 *
 * Reuses:
 *  - padding.ts (calcPadding) for edge padding before OCR
 *  - offscreen OCR pipeline via chrome.runtime.sendMessage
 */

import { calcPadding } from "../ocr/engine/padding";
import { loadRules, applyCleaningRules } from "../shared/cleaning";
import { loadSettings } from "../shared/settings";
import { addToHistory } from "../shared/ocr-history";
import {
  loadPdf,
  PdfPasswordError,
  PdfLoadError,
  PdfRenderError,
  type PdfDocument,
} from "../pdf/pdf-loader";
import {
  initQuad,
  hitTestCorner,
  moveCorner,
  suggestOutputSize,
  outputCorners,
  type QuadState,
  type Corner,
} from "./quad-selection";
import {
  computeHomography,
  applyPerspective,
  type Point,
} from "../ocr/engine/perspective";

const t = chrome.i18n.getMessage;

// ── DOM elements ──

const btnOpen = document.getElementById("btn-open") as HTMLButtonElement;
const btnSelect = document.getElementById("btn-select") as HTMLButtonElement;
const btnQuadSelect = document.getElementById(
  "btn-quad-select",
) as HTMLButtonElement;
const btnQuadConfirm = document.getElementById(
  "btn-quad-confirm",
) as HTMLButtonElement;
const btnOcrAll = document.getElementById("btn-ocr-all") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const quadPreviewPanel = document.getElementById(
  "quad-preview-panel",
) as HTMLDivElement;
const quadPreviewCanvas = document.getElementById(
  "quad-preview",
) as HTMLCanvasElement;
const QUAD_PREVIEW_MAX_PX = 240;
const canvasArea = document.getElementById("canvas-area")!;
const dropzone = document.getElementById("dropzone")!;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const statusEl = document.getElementById("status")!;
const toastEl = document.getElementById("toast")!;
const pdfNav = document.getElementById("pdf-nav")!;
const btnPdfPrev = document.getElementById("btn-pdf-prev") as HTMLButtonElement;
const btnPdfNext = document.getElementById("btn-pdf-next") as HTMLButtonElement;
const pdfPageIndicator = document.getElementById("pdf-page-indicator")!;

// Apply i18n
document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
  const key = el.dataset.i18n!;
  const msg = t(key);
  if (msg) el.textContent = msg;
});
document
  .querySelectorAll<HTMLElement>("[data-i18n-title]")
  .forEach((el) => {
    const key = el.dataset.i18nTitle!;
    const msg = t(key);
    if (msg) el.title = msg;
  });

// ── State ──

let img: HTMLImageElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let selectMode = false; // rectangular selection mode
let dragging = false;
let startX = 0;
let startY = 0;
let selRect: { x: number; y: number; w: number; h: number } | null = null;

// "Deskew & select" mode — a perspective-corrected quad selection.
let quadMode = false;
let quadState: QuadState | null = null;
// Cached source pixels for the live preview, captured once when quad mode
// starts so each drag update doesn't re-read the full main canvas.
let quadSrcData: ImageData | null = null;
let quadPreviewRafPending = false;

// PDF mode state: null when a plain image is loaded.
let pdfDoc: PdfDocument | null = null;
let pdfCurrentPage = 1;
let pdfSourceName: string | null = null;

// ── Toast ──

let toastTimer: number | null = null;

function showToast(msg: string, duration = 0): void {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  if (duration > 0) {
    toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), duration);
  }
}

function hideToast(): void {
  toastEl.classList.remove("show");
}

// ── File loading ──

let currentImageName: string | null = null;

function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

function loadFile(file: File): void {
  if (isPdfFile(file)) {
    void loadPdfFile(file);
    return;
  }
  loadImageFile(file);
}

function loadImageFile(file: File): void {
  // Switching from PDF → image: tear down any live PDF document.
  void disposePdfDoc();
  const url = URL.createObjectURL(file);
  const image = new Image();
  currentImageName = file.name || null;
  image.onload = () => {
    img = image;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    ctx = canvas.getContext("2d")!;
    drawImage();
    dropzone.style.display = "none";
    canvas.style.display = "block";
    canvas.style.cursor = "default";
    btnSelect.disabled = false;
    btnQuadSelect.disabled = false;
    btnOcrAll.disabled = false;
    selectMode = false;
    quadMode = false;
    quadState = null;
    btnQuadConfirm.style.display = "none";
    hideQuadPreview();
    statusEl.textContent = `${image.naturalWidth}×${image.naturalHeight}`;
    URL.revokeObjectURL(url);
  };
  image.src = url;
}

// ── PDF handling ──

async function disposePdfDoc(): Promise<void> {
  if (pdfDoc) {
    try {
      await pdfDoc.destroy();
    } catch {
      /* best-effort */
    }
    pdfDoc = null;
  }
  pdfCurrentPage = 1;
  pdfSourceName = null;
  updatePdfNavUi();
}

function updatePdfNavUi(): void {
  if (!pdfDoc) {
    pdfNav.classList.remove("active");
    return;
  }
  pdfNav.classList.add("active");
  pdfPageIndicator.textContent =
    t("viewerPdfPageIndicator", [
      String(pdfCurrentPage),
      String(pdfDoc.pageCount),
    ]) || `${pdfCurrentPage} / ${pdfDoc.pageCount}`;
  btnPdfPrev.disabled = pdfCurrentPage <= 1;
  btnPdfNext.disabled = pdfCurrentPage >= pdfDoc.pageCount;
}

async function loadPdfFile(file: File): Promise<void> {
  await disposePdfDoc();
  showToast(t("statusLoading") || "読み込み中…");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    pdfDoc = await loadPdf(bytes);
    pdfCurrentPage = 1;
    pdfSourceName = file.name || "document.pdf";
    await renderPdfPage(pdfCurrentPage);
    updatePdfNavUi();
    hideToast();
  } catch (e) {
    let msg: string;
    if (e instanceof PdfPasswordError) {
      msg =
        t("viewerPdfPasswordError") ||
        "パスワード付き PDF は現在サポートしていません";
    } else if (e instanceof PdfLoadError) {
      msg =
        t("viewerPdfLoadError") || "PDF ファイルを読み込めませんでした";
    } else {
      msg = e instanceof Error ? e.message : String(e);
    }
    showToast(msg, 5000);
    await disposePdfDoc();
  }
}

async function renderPdfPage(pageNumber: number): Promise<void> {
  if (!pdfDoc) return;
  try {
    const page = await pdfDoc.getPage(pageNumber);
    const blob = await page.render();
    const url = URL.createObjectURL(blob);
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("failed to load rendered page"));
      image.src = url;
    });
    img = image;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    ctx = canvas.getContext("2d")!;
    drawImage();
    dropzone.style.display = "none";
    canvas.style.display = "block";
    canvas.style.cursor = "default";
    btnSelect.disabled = false;
    btnQuadSelect.disabled = false;
    btnOcrAll.disabled = false;
    selectMode = false;
    quadMode = false;
    quadState = null;
    btnQuadConfirm.style.display = "none";
    hideQuadPreview();
    selRect = null;
    URL.revokeObjectURL(url);
    // Show 1-indexed pageName so OCR history captures which page a result
    // came from, e.g. "invoice.pdf#p2".
    currentImageName = pdfSourceName
      ? `${pdfSourceName}#p${pageNumber}`
      : `p${pageNumber}`;
    statusEl.textContent = `${image.naturalWidth}×${image.naturalHeight} — page ${pageNumber} / ${pdfDoc.pageCount}`;
  } catch (e) {
    const msg =
      e instanceof PdfRenderError || e instanceof Error
        ? e.message
        : String(e);
    showToast(
      `${t("viewerPdfRenderError") || "PDF ページの描画に失敗しました"}: ${msg}`,
      5000,
    );
  }
}

async function goToPdfPage(pageNumber: number): Promise<void> {
  if (!pdfDoc) return;
  if (pageNumber < 1 || pageNumber > pdfDoc.pageCount) return;
  if (pageNumber === pdfCurrentPage) return;
  pdfCurrentPage = pageNumber;
  updatePdfNavUi();
  await renderPdfPage(pdfCurrentPage);
}

btnPdfPrev.addEventListener("click", () => {
  void goToPdfPage(pdfCurrentPage - 1);
});
btnPdfNext.addEventListener("click", () => {
  void goToPdfPage(pdfCurrentPage + 1);
});

// Arrow keys navigate pages when a PDF is loaded and we're not in the middle
// of a selection.
document.addEventListener("keydown", (e) => {
  if (!pdfDoc || selectMode || dragging || quadMode) return;
  if (e.key === "ArrowLeft" || e.key === "PageUp") {
    e.preventDefault();
    void goToPdfPage(pdfCurrentPage - 1);
  } else if (e.key === "ArrowRight" || e.key === "PageDown") {
    e.preventDefault();
    void goToPdfPage(pdfCurrentPage + 1);
  }
});

function drawImage(): void {
  if (!ctx || !img) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
}

function drawSelection(): void {
  if (!ctx || !img || !selRect) return;
  drawImage();
  const { x, y, w, h } = selRect;
  ctx.strokeStyle = "#5B9BD5";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(91,155,213,0.15)";
  ctx.fillRect(x, y, w, h);
}

/**
 * Render the perspective-corrected quad into the top-right preview panel.
 * Runs on every drag — rAF-coalesced so a fast drag doesn't queue up more
 * work than the compositor can flush, and clamped to QUAD_PREVIEW_MAX_PX so
 * the warp stays cheap even on multi-megapixel source images.
 */
function updateQuadPreview(): void {
  if (quadPreviewRafPending) return;
  quadPreviewRafPending = true;
  requestAnimationFrame(() => {
    quadPreviewRafPending = false;
    if (!quadMode || !quadState || !quadSrcData) return;
    const size = suggestOutputSize(quadState);
    const scale = Math.min(
      1,
      QUAD_PREVIEW_MAX_PX / size.w,
      QUAD_PREVIEW_MAX_PX / size.h,
    );
    const outW = Math.max(2, Math.round(size.w * scale));
    const outH = Math.max(2, Math.round(size.h * scale));
    const dst: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ];
    try {
      const H = computeHomography(
        quadState.corners as unknown as Point[],
        dst as unknown as Point[],
      );
      const warped = applyPerspective(quadSrcData, H, outW, outH);
      quadPreviewCanvas.width = outW;
      quadPreviewCanvas.height = outH;
      const pctx = quadPreviewCanvas.getContext("2d");
      if (pctx) pctx.putImageData(warped, 0, 0);
    } catch {
      // computeHomography can throw on degenerate quads — silently keep the
      // previous preview; the convexity constraint on moveCorner should
      // normally keep us out of this branch.
    }
  });
}

function showQuadPreview(): void {
  if (!ctx) return;
  quadSrcData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  quadPreviewPanel.classList.add("active");
  updateQuadPreview();
}

function hideQuadPreview(): void {
  quadPreviewPanel.classList.remove("active");
  quadSrcData = null;
}

function drawQuad(): void {
  if (!ctx || !img || !quadState) return;
  drawImage();
  const c = quadState.corners;
  ctx.fillStyle = "rgba(91,155,213,0.15)";
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#5B9BD5";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Corner handles — radius in canvas-space, scaled so on-screen size stays constant.
  const rect = canvas.getBoundingClientRect();
  const displayScale = rect.width > 0 ? canvas.width / rect.width : 1;
  const handleR = 8 * displayScale;
  ctx.lineWidth = 2 * displayScale;
  for (let i = 0; i < 4; i++) {
    const p = c[i];
    ctx.fillStyle = i === quadState.draggingIndex ? "#3892ee" : "#5B9BD5";
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, handleR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

// ── Canvas coordinate conversion ──

function canvasCoords(e: MouseEvent): { cx: number; cy: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    cx: (e.clientX - rect.left) * scaleX,
    cy: (e.clientY - rect.top) * scaleY,
  };
}

// ── Selection handlers ──

canvas.addEventListener("mousedown", (e) => {
  if (!img) return;
  const { cx, cy } = canvasCoords(e);
  if (quadMode && quadState) {
    const rect = canvas.getBoundingClientRect();
    const displayScale = rect.width > 0 ? canvas.width / rect.width : 1;
    const idx = hitTestCorner(
      quadState,
      { x: cx, y: cy },
      16 * displayScale,
    );
    if (idx !== -1) {
      quadState = { corners: quadState.corners, draggingIndex: idx };
      drawQuad();
    }
    return;
  }
  if (!selectMode) return;
  dragging = true;
  startX = cx;
  startY = cy;
  selRect = null;
});

canvas.addEventListener("mousemove", (e) => {
  const { cx, cy } = canvasCoords(e);
  if (quadMode && quadState && quadState.draggingIndex !== -1) {
    quadState = moveCorner(
      quadState,
      quadState.draggingIndex as Corner,
      { x: cx, y: cy },
      canvas.width,
      canvas.height,
    );
    drawQuad();
    updateQuadPreview();
    return;
  }
  if (!dragging) return;
  selRect = {
    x: Math.min(startX, cx),
    y: Math.min(startY, cy),
    w: Math.abs(cx - startX),
    h: Math.abs(cy - startY),
  };
  drawSelection();
});

canvas.addEventListener("mouseup", (e) => {
  if (quadMode && quadState && quadState.draggingIndex !== -1) {
    quadState = { corners: quadState.corners, draggingIndex: -1 };
    drawQuad();
    return;
  }
  if (!dragging) return;
  dragging = false;
  const { cx, cy } = canvasCoords(e);
  selRect = {
    x: Math.min(startX, cx),
    y: Math.min(startY, cy),
    w: Math.abs(cx - startX),
    h: Math.abs(cy - startY),
  };
  drawSelection();
  if (selRect.w > 5 && selRect.h > 5) {
    selectMode = false;
    canvas.style.cursor = "default";
    void runOcr();
  }
});

// Esc to cancel selection / quad mode
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    selectMode = false;
    dragging = false;
    quadMode = false;
    quadState = null;
    btnQuadConfirm.style.display = "none";
    hideQuadPreview();
    canvas.style.cursor = "default";
    selRect = null;
    drawImage();
  }
});

// ── OCR ──

async function runOcr(): Promise<void> {
  if (!ctx || !img || !selRect) return;
  await sendImageToOcr(canvas, selRect);
}

/**
 * Feed a source canvas + crop rect through the padding + PNG + offscreen-OCR
 * pipeline. Shared between rectangular selection and four-corner (warped)
 * selection — the warped path passes an OffscreenCanvas containing the already
 * perspective-corrected image, with a full-image crop rect.
 */
async function sendImageToOcr(
  source: HTMLCanvasElement | OffscreenCanvas,
  crop: { x: number; y: number; w: number; h: number },
): Promise<void> {
  showToast(t("progressOcrRunning") || "OCR実行中…");

  const pad = calcPadding(crop.w, crop.h);
  const cropX = Math.round(crop.x);
  const cropY = Math.round(crop.y);
  const cropW = Math.round(crop.w);
  const cropH = Math.round(crop.h);

  const outW = cropW + pad * 2;
  const outH = cropH + pad * 2;
  const offscreen = new OffscreenCanvas(outW, outH);
  const offCtx = offscreen.getContext("2d")!;

  offCtx.drawImage(source, cropX, cropY, cropW, cropH, pad, pad, cropW, cropH);

  offCtx.drawImage(offscreen, pad, pad, cropW, 1, pad, 0, cropW, pad);
  offCtx.drawImage(
    offscreen,
    pad,
    pad + cropH - 1,
    cropW,
    1,
    pad,
    pad + cropH,
    cropW,
    pad,
  );
  offCtx.drawImage(offscreen, pad, 0, 1, outH, 0, 0, pad, outH);
  offCtx.drawImage(
    offscreen,
    pad + cropW - 1,
    0,
    1,
    outH,
    pad + cropW,
    0,
    pad,
    outH,
  );

  const blob = await offscreen.convertToBlob({ type: "image/png" });
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

  const currentTab = await chrome.tabs.getCurrent();
  await chrome.runtime.sendMessage({
    target: "background",
    type: "viewer-ocr-start",
    tabId: currentTab?.id,
  });

  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "run-ocr",
    screenshotDataUrl: dataUrl,
    rect: { x: 0, y: 0, width: outW, height: outH },
    devicePixelRatio: 1,
  });
}

async function confirmQuad(): Promise<void> {
  if (!ctx || !img || !quadState) return;
  const { w: outW, h: outH } = suggestOutputSize(quadState);
  const dstCorners = outputCorners(outW, outH);
  const H = computeHomography(
    quadState.corners as unknown as Point[],
    dstCorners as unknown as Point[],
  );
  const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const warped = applyPerspective(srcData, H, outW, outH);

  const warpedCanvas = new OffscreenCanvas(outW, outH);
  const wCtx = warpedCanvas.getContext("2d")!;
  wCtx.putImageData(warped, 0, 0);

  // Exit quad mode before firing OCR — the result handler resets shared state.
  quadMode = false;
  quadState = null;
  btnQuadConfirm.style.display = "none";
  hideQuadPreview();
  canvas.style.cursor = "default";
  drawImage();

  await sendImageToOcr(warpedCanvas, { x: 0, y: 0, w: outW, h: outH });
}

async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS" as chrome.offscreen.Reason],
    justification: t("offscreenJustification") || "OCR inference",
  });
}

// ── Listen for OCR results from background ──

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return;
  const target = (message as { target?: string }).target;
  if (target !== "content") return;

  if (message.type === "ocr-progress") {
    showToast(message.phase || "処理中…");
  } else if (message.type === "ocr-result") {
    const rawText = message.text as string;
    if (!rawText) {
      showToast(t("toastNoTextDetected") || "文字を検出できませんでした", 3000);
      loadSettings().then((s) => {
        if (s.showResultAlert ?? true) window.alert(t("toastNoTextDetected"));
      });
      return;
    }
    // Apply cleaning rules and settings (same as content script)
    Promise.all([loadRules(), loadSettings()]).then(async ([rules, settings]) => {
      const cleaned = applyCleaningRules(rawText, rules)
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .trim();
      const ok = await navigator.clipboard.writeText(cleaned).then(() => true).catch(() => false);
      const len = cleaned.length;
      if (ok) {
        showToast(t("toastCopied", [String(len)]) || `コピーしました (${len}文字)`, 4000);
      } else {
        showToast(t("toastClipboardFailed") || "クリップボードに書き込めませんでした", 4000);
      }
      if ((settings.historyEnabled ?? true) && cleaned.length > 0) {
        const sourceName = currentImageName;
        void addToHistory(cleaned, {
          pageTitle: sourceName ?? t("historySourceViewer"),
          maxItems: settings.historyMaxItems,
        });
      }
      if (settings.showResultAlert ?? true) {
        const header = ok
          ? t("alertResultCopied", [String(len)])
          : t("alertResultCopyFailed", [String(len)]);
        window.alert(`${header}\n\n${cleaned}`);
      }
    });
    selRect = null;
    quadMode = false;
    quadState = null;
    btnQuadConfirm.style.display = "none";
    hideQuadPreview();
    drawImage();
  } else if (message.type === "ocr-error") {
    showToast(`${t("errorPrefix", [message.message]) || message.message}`, 5000);
    selRect = null;
    quadMode = false;
    quadState = null;
    btnQuadConfirm.style.display = "none";
    hideQuadPreview();
    drawImage();
  }
});

// ── Toolbar buttons ──

btnOpen.addEventListener("click", () => fileInput.click());

btnSelect.addEventListener("click", () => {
  if (!img) return;
  quadMode = false;
  quadState = null;
  btnQuadConfirm.style.display = "none";
  hideQuadPreview();
  selectMode = true;
  canvas.style.cursor = "crosshair";
  selRect = null;
  drawImage();
  statusEl.textContent = t("viewerSelectHint") || "ドラッグでOCRしたい範囲を選択";
});

btnQuadSelect.addEventListener("click", () => {
  if (!img) return;
  selectMode = false;
  selRect = null;
  quadMode = true;
  quadState = initQuad(canvas.width, canvas.height);
  btnQuadConfirm.style.display = "";
  btnQuadConfirm.disabled = false;
  canvas.style.cursor = "grab";
  drawQuad();
  showQuadPreview();
  statusEl.textContent =
    t("viewerQuadHint") ||
    "4つのハンドルを文字の四隅に合わせて [この範囲でOCR] を押してください";
});

btnQuadConfirm.addEventListener("click", () => {
  void confirmQuad();
});

btnOcrAll.addEventListener("click", () => {
  if (!img) return;
  selRect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  void runOcr();
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

// ── Drag & drop ──

canvasArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  canvasArea.style.outline = "2px dashed #4ea3ff";
});

canvasArea.addEventListener("dragleave", () => {
  canvasArea.style.outline = "";
});

canvasArea.addEventListener("drop", (e) => {
  e.preventDefault();
  canvasArea.style.outline = "";
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

// ── Paste from clipboard (Ctrl+V) ──

document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (blob) loadFile(blob);
      return;
    }
  }
});

// ── Auto-load image or PDF from popup (via session storage) ──

(async () => {
  const stored = await chrome.storage.session.get([
    "viewerImage",
    "viewerPdf",
    "viewerPdfName",
  ]);
  if (stored.viewerPdf) {
    await chrome.storage.session.remove(["viewerPdf", "viewerPdfName"]);
    const res = await fetch(stored.viewerPdf as string);
    const blob = await res.blob();
    const name = (stored.viewerPdfName as string) || "document.pdf";
    const file = new File([blob], name, { type: "application/pdf" });
    loadFile(file);
  } else if (stored.viewerImage) {
    await chrome.storage.session.remove("viewerImage");
    const res = await fetch(stored.viewerImage as string);
    const blob = await res.blob();
    const file = new File([blob], "image.png", { type: blob.type });
    loadFile(file);
  }
})();
