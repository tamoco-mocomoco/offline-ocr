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

const t = chrome.i18n.getMessage;

// ── DOM elements ──

const btnOpen = document.getElementById("btn-open") as HTMLButtonElement;
const btnSelect = document.getElementById("btn-select") as HTMLButtonElement;
const btnOcrAll = document.getElementById("btn-ocr-all") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
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
let selectMode = false; // whether selection mode is active
let dragging = false;
let startX = 0;
let startY = 0;
let selRect: { x: number; y: number; w: number; h: number } | null = null;

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
    btnOcrAll.disabled = false;
    selectMode = false;
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
    btnOcrAll.disabled = false;
    selectMode = false;
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
  if (!pdfDoc || selectMode || dragging) return;
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
  if (!img || !selectMode) return;
  const { cx, cy } = canvasCoords(e);
  dragging = true;
  startX = cx;
  startY = cy;
  selRect = null;
});

canvas.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const { cx, cy } = canvasCoords(e);
  selRect = {
    x: Math.min(startX, cx),
    y: Math.min(startY, cy),
    w: Math.abs(cx - startX),
    h: Math.abs(cy - startY),
  };
  drawSelection();
});

canvas.addEventListener("mouseup", (e) => {
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

// Esc to cancel selection
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    selectMode = false;
    dragging = false;
    canvas.style.cursor = "default";
    selRect = null;
    drawImage();
  }
});

// ── OCR ──

async function runOcr(): Promise<void> {
  if (!ctx || !img || !selRect) return;

  showToast(t("progressOcrRunning") || "OCR実行中…");

  // Crop the selected region with adjacent-color padding
  const pad = calcPadding(selRect.w, selRect.h);
  const cropX = Math.round(selRect.x);
  const cropY = Math.round(selRect.y);
  const cropW = Math.round(selRect.w);
  const cropH = Math.round(selRect.h);

  const outW = cropW + pad * 2;
  const outH = cropH + pad * 2;
  const offscreen = new OffscreenCanvas(outW, outH);
  const offCtx = offscreen.getContext("2d")!;

  // Draw the cropped region in the center
  offCtx.drawImage(canvas, cropX, cropY, cropW, cropH, pad, pad, cropW, cropH);

  // Stretch edge pixels for adjacent-color padding
  offCtx.drawImage(offscreen, pad, pad, cropW, 1, pad, 0, cropW, pad);
  offCtx.drawImage(offscreen, pad, pad + cropH - 1, cropW, 1, pad, pad + cropH, cropW, pad);
  offCtx.drawImage(offscreen, pad, 0, 1, outH, 0, 0, pad, outH);
  offCtx.drawImage(offscreen, pad + cropW - 1, 0, 1, outH, pad + cropW, 0, pad, outH);

  // Convert to data URL for the offscreen OCR pipeline
  const blob = await offscreen.convertToBlob({ type: "image/png" });
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

  // Notify background to set activeOcrTabId for result routing
  const currentTab = await chrome.tabs.getCurrent();
  await chrome.runtime.sendMessage({
    target: "background",
    type: "viewer-ocr-start",
    tabId: currentTab?.id,
  });

  // Send to offscreen OCR (reuse existing pipeline)
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "run-ocr",
    screenshotDataUrl: dataUrl,
    rect: { x: 0, y: 0, width: outW, height: outH },
    devicePixelRatio: 1,
  });
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
    drawImage();
  } else if (message.type === "ocr-error") {
    showToast(`${t("errorPrefix", [message.message]) || message.message}`, 5000);
    selRect = null;
    drawImage();
  }
});

// ── Toolbar buttons ──

btnOpen.addEventListener("click", () => fileInput.click());

btnSelect.addEventListener("click", () => {
  if (!img) return;
  selectMode = true;
  canvas.style.cursor = "crosshair";
  selRect = null;
  drawImage();
  statusEl.textContent = t("viewerSelectHint") || "ドラッグでOCRしたい範囲を選択";
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
