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
import {
  EraseLog,
  dominantColor,
  eraserRadius,
  paintStroke,
  samplingRect,
  type EraseStroke,
  type EraserSize,
} from "./eraser";

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
const btnErase = document.getElementById("btn-erase") as HTMLButtonElement;
const eraserTools = document.getElementById("eraser-tools")!;
const eraserSizeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".eraser-size"),
);
const btnEraseUndo = document.getElementById(
  "btn-erase-undo",
) as HTMLButtonElement;
const btnEraseReset = document.getElementById(
  "btn-erase-reset",
) as HTMLButtonElement;
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
// The image as OCR sees it: the loaded image plus any eraser strokes. The
// on-screen canvas is this plus the selection UI (fill, outline, handles,
// eraser cursor) drawn on top, so OCR and the quad preview must always read
// from here, never from `canvas`.
let workCanvas: OffscreenCanvas | null = null;
let workCtx: OffscreenCanvasRenderingContext2D | null = null;

// rect: rectangular selection, quad: "Deskew & select" (perspective-corrected
// quad selection), erase: eraser.
type ViewerMode = "idle" | "rect" | "quad" | "erase";
let mode: ViewerMode = "idle";
let dragging = false;
let startX = 0;
let startY = 0;
let selRect: { x: number; y: number; w: number; h: number } | null = null;

let quadState: QuadState | null = null;
// Cached source pixels for the live preview, captured once when quad mode
// starts so each drag update doesn't re-read the full main canvas.
let quadSrcData: ImageData | null = null;
let quadPreviewRafPending = false;

// PDF mode state: null when a plain image is loaded.
let pdfDoc: PdfDocument | null = null;
let pdfCurrentPage = 1;
let pdfSourceName: string | null = null;

// Eraser state. Strokes are logged per PDF page (0 for a plain image).
const eraseLog = new EraseLog();
let eraserSize: EraserSize = "m";
let erasing: EraseStroke | null = null; // stroke in progress
let eraserCursor: Point | null = null;

function pageKey(): number {
  return pdfDoc ? pdfCurrentPage : 0;
}

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
    eraseLog.clearAll();
    showImage(image);
    statusEl.textContent = `${image.naturalWidth}×${image.naturalHeight}`;
    URL.revokeObjectURL(url);
  };
  image.src = url;
}

/**
 * Make `image` the current image (a loaded file or a rendered PDF page):
 * size the canvases, re-apply this page's eraser strokes, and leave any mode.
 */
function showImage(image: HTMLImageElement): void {
  // A stroke still in progress belongs to the previous image — drop it.
  erasing = null;
  img = image;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx = canvas.getContext("2d")!;
  workCanvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
  workCtx = workCanvas.getContext("2d")!;
  dropzone.style.display = "none";
  canvas.style.display = "block";
  btnSelect.disabled = false;
  btnQuadSelect.disabled = false;
  btnOcrAll.disabled = false;
  btnErase.disabled = false;
  setMode("idle");
  rebuildWorkImage();
  drawImage();
}

/** Redraw the work image from the original plus this page's eraser strokes. */
function rebuildWorkImage(): void {
  if (!workCtx || !workCanvas || !img) return;
  workCtx.clearRect(0, 0, workCanvas.width, workCanvas.height);
  workCtx.drawImage(img, 0, 0);
  for (const s of eraseLog.strokes(pageKey())) paintStroke(workCtx, s);
  updateEraserButtons();
}

/**
 * Switch modes, tearing down whatever the previous mode left on screen
 * (selection rect, quad handles + preview, eraser cursor). Callers set up the
 * new mode's own state and redraw.
 */
function setMode(next: ViewerMode): void {
  if (erasing) finishStroke();
  mode = next;
  dragging = false;
  selRect = null;
  if (next !== "quad") {
    quadState = null;
    btnQuadConfirm.style.display = "none";
    hideQuadPreview();
  }
  if (next !== "erase") eraserCursor = null;
  const erasingMode = next === "erase";
  btnErase.classList.toggle("active", erasingMode);
  btnErase.setAttribute("aria-pressed", String(erasingMode));
  eraserTools.classList.toggle("active", erasingMode);
  canvas.style.cursor =
    next === "rect"
      ? "crosshair"
      : next === "quad"
        ? "grab"
        : next === "erase"
          ? "none"
          : "default";
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
  eraseLog.clearAll();
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
    showImage(image);
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
  if (!pdfDoc || mode !== "idle" || dragging) return;
  if (e.key === "ArrowLeft" || e.key === "PageUp") {
    e.preventDefault();
    void goToPdfPage(pdfCurrentPage - 1);
  } else if (e.key === "ArrowRight" || e.key === "PageDown") {
    e.preventDefault();
    void goToPdfPage(pdfCurrentPage + 1);
  }
});

function drawImage(): void {
  if (!ctx || !workCanvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(workCanvas, 0, 0);
}

/** Redraw the screen for the current mode. */
function redraw(): void {
  if (mode === "quad") drawQuad();
  else if (mode === "erase") drawEraserCursor();
  else if (selRect) drawSelection();
  else drawImage();
}

/** Canvas pixels per CSS pixel, for UI that should keep a constant on-screen size. */
function displayScale(): number {
  const rect = canvas.getBoundingClientRect();
  return rect.width > 0 ? canvas.width / rect.width : 1;
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
    if (mode !== "quad" || !quadState || !quadSrcData) return;
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
  if (!workCtx) return;
  quadSrcData = workCtx.getImageData(0, 0, canvas.width, canvas.height);
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
  const scale = displayScale();
  const handleR = 8 * scale;
  ctx.lineWidth = 2 * scale;
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

// ── Eraser ──

/** Screen = work image + a ring showing the brush size under the pointer. */
function drawEraserCursor(): void {
  drawImage();
  if (!ctx || !eraserCursor) return;
  const scale = displayScale();
  const r = eraserRadius(eraserSize, scale);
  ctx.save();
  ctx.beginPath();
  ctx.arc(eraserCursor.x, eraserCursor.y, r, 0, Math.PI * 2);
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = "#5B9BD5";
  ctx.stroke();
  ctx.lineWidth = 1 * scale;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.restore();
}

function startStroke(p: Point): void {
  if (!workCtx || !workCanvas) return;
  const radius = eraserRadius(eraserSize, displayScale());
  // Fill with the surrounding background so the erased patch blends in
  // instead of leaving an edge for DEIM to detect.
  const s = samplingRect(p, radius, workCanvas.width, workCanvas.height);
  const color = dominantColor(workCtx.getImageData(s.x, s.y, s.w, s.h).data);
  erasing = { points: [p], radius, color };
  paintStroke(workCtx, erasing);
}

function extendStroke(p: Point): void {
  if (!workCtx || !erasing) return;
  erasing.points.push(p);
  paintStroke(workCtx, erasing, erasing.points.length - 1);
}

function finishStroke(): void {
  if (!erasing) return;
  eraseLog.push(pageKey(), erasing);
  erasing = null;
  updateEraserButtons();
}

function undoErase(): void {
  if (erasing) finishStroke();
  if (!eraseLog.undo(pageKey())) return;
  rebuildWorkImage();
  redraw();
}

function resetErase(): void {
  if (erasing) finishStroke();
  eraseLog.clearPage(pageKey());
  rebuildWorkImage();
  redraw();
}

function updateEraserButtons(): void {
  const none = eraseLog.count(pageKey()) === 0;
  btnEraseUndo.disabled = none;
  btnEraseReset.disabled = none;
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
  if (mode === "erase") {
    if (e.button !== 0) return;
    eraserCursor = { x: cx, y: cy };
    startStroke(eraserCursor);
    drawEraserCursor();
    return;
  }
  if (mode === "quad" && quadState) {
    const idx = hitTestCorner(
      quadState,
      { x: cx, y: cy },
      16 * displayScale(),
    );
    if (idx !== -1) {
      quadState = { corners: quadState.corners, draggingIndex: idx };
      drawQuad();
    }
    return;
  }
  if (mode !== "rect") return;
  dragging = true;
  startX = cx;
  startY = cy;
  selRect = null;
});

canvas.addEventListener("mousemove", (e) => {
  const { cx, cy } = canvasCoords(e);
  if (mode === "erase") {
    eraserCursor = { x: cx, y: cy };
    if (erasing) extendStroke(eraserCursor);
    drawEraserCursor();
    return;
  }
  if (mode === "quad" && quadState && quadState.draggingIndex !== -1) {
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
  if (mode === "erase") {
    finishStroke();
    return;
  }
  if (mode === "quad" && quadState && quadState.draggingIndex !== -1) {
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
    // Leave selection mode but keep the rect on screen while OCR runs.
    const rect = selRect;
    setMode("idle");
    selRect = rect;
    void runOcr();
  }
});

// A stroke ends when the pointer leaves the canvas, so re-entering elsewhere
// doesn't draw a straight line across the image.
canvas.addEventListener("mouseleave", () => {
  if (mode !== "erase") return;
  finishStroke();
  eraserCursor = null;
  drawEraserCursor();
});

// Esc to cancel selection / quad / eraser mode; Enter to confirm quad OCR;
// Ctrl+Z (Cmd+Z) to undo the last eraser stroke.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setMode("idle");
    drawImage();
    return;
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === "z"
  ) {
    if (mode !== "idle" && mode !== "erase") return;
    if (!erasing && eraseLog.count(pageKey()) === 0) return;
    e.preventDefault();
    undoErase();
    return;
  }
  if (
    e.key === "Enter" &&
    mode === "quad" &&
    quadState &&
    quadState.draggingIndex === -1
  ) {
    // If the confirm button happens to have focus, let its native click fire
    // instead of double-triggering confirmQuad.
    if (e.target === btnQuadConfirm) return;
    e.preventDefault();
    void confirmQuad();
  }
});

// ── OCR ──

async function runOcr(): Promise<void> {
  if (!workCanvas || !selRect) return;
  await sendImageToOcr(workCanvas, selRect);
}

/**
 * Feed a source canvas + crop rect through the padding + PNG + offscreen-OCR
 * pipeline. Shared between rectangular selection and four-corner (warped)
 * selection — the warped path passes an OffscreenCanvas containing the already
 * perspective-corrected image, with a full-image crop rect.
 *
 * `source` must be the work image (or derived from it), never the on-screen
 * canvas: the selection UI drawn there would end up in the OCR input, and the
 * edge padding would stretch its outline into stripes.
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
  if (!workCtx || !quadState) return;
  const { w: outW, h: outH } = suggestOutputSize(quadState);
  const dstCorners = outputCorners(outW, outH);
  const H = computeHomography(
    quadState.corners as unknown as Point[],
    dstCorners as unknown as Point[],
  );
  const srcData = workCtx.getImageData(0, 0, canvas.width, canvas.height);
  const warped = applyPerspective(srcData, H, outW, outH);

  const warpedCanvas = new OffscreenCanvas(outW, outH);
  const wCtx = warpedCanvas.getContext("2d")!;
  wCtx.putImageData(warped, 0, 0);

  setMode("idle");
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
    // Clear the selection shown while OCR ran. A mode the user entered in the
    // meantime (e.g. the eraser) is left alone.
    selRect = null;
    redraw();
  } else if (message.type === "ocr-error") {
    showToast(`${t("errorPrefix", [message.message]) || message.message}`, 5000);
    selRect = null;
    redraw();
  }
});

// ── Toolbar buttons ──

btnOpen.addEventListener("click", () => fileInput.click());

btnSelect.addEventListener("click", () => {
  if (!img) return;
  setMode("rect");
  drawImage();
  statusEl.textContent = t("viewerSelectHint") || "ドラッグでOCRしたい範囲を選択";
});

btnQuadSelect.addEventListener("click", () => {
  if (!img) return;
  // Blur so Enter doesn't re-fire this handler (which would reset the quad).
  btnQuadSelect.blur();
  setMode("quad");
  quadState = initQuad(canvas.width, canvas.height);
  btnQuadConfirm.style.display = "";
  btnQuadConfirm.disabled = false;
  drawQuad();
  showQuadPreview();
  statusEl.textContent =
    t("viewerQuadHint") ||
    "4つのハンドルを文字の四隅に合わせて [この範囲でOCR] (Enter) を押してください";
});

btnQuadConfirm.addEventListener("click", () => {
  void confirmQuad();
});

btnOcrAll.addEventListener("click", () => {
  if (!img) return;
  setMode("idle");
  drawImage();
  selRect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  void runOcr();
});

btnErase.addEventListener("click", () => {
  if (!img) return;
  // Blur so Space/Enter while painting doesn't toggle the mode back off.
  btnErase.blur();
  if (mode === "erase") {
    setMode("idle");
    drawImage();
    statusEl.textContent = `${canvas.width}×${canvas.height}`;
    return;
  }
  setMode("erase");
  drawEraserCursor();
  statusEl.textContent =
    t("viewerEraserHint") ||
    "OCRしたくない部分をなぞって消してください (Ctrl+Z で元に戻す / Escで終了)";
});

for (const btn of eraserSizeButtons) {
  btn.addEventListener("click", () => {
    eraserSize = btn.dataset.size as EraserSize;
    for (const b of eraserSizeButtons) {
      const on = b === btn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    btn.blur();
  });
}

btnEraseUndo.addEventListener("click", () => undoErase());
btnEraseReset.addEventListener("click", () => resetErase());
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
