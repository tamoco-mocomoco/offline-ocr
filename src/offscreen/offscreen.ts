/**
 * Offscreen document entrypoint.
 *
 * Owns the OCR Web Worker (which loads ONNX Runtime Web + the DEIM/PARSeq
 * models). Acts as a bridge between the background service worker (which
 * speaks `chrome.runtime.sendMessage`) and the worker (which speaks
 * `postMessage`).
 *
 * On first launch it sends a `configure` message to the worker with absolute
 * `chrome-extension://` URLs for both the ORT WASM assets and the ONNX model
 * files, because the worker itself has no access to `chrome.runtime.getURL`.
 */

import OcrWorker from "../ocr/worker/ocr.worker.ts?worker";
import type { WorkerResponse } from "../ocr/worker/ocr.worker";
import type {
  AnyMessage,
  BackgroundToOffscreen,
  OffscreenToBackground,
  Rect,
} from "../shared/messages";
import { calcPadding } from "../ocr/engine/padding";

/**
 * Crop a region out of the captured screenshot data URL and return a PNG Blob.
 * Adds padding by stretching the edge pixels outward (adjacent-color padding)
 * so that tightly selected text can still be detected by DEIM.
 *
 * `chrome.tabs.captureVisibleTab` returns physical-pixel image data already
 * scaled by devicePixelRatio. The selection rect is in CSS pixels, so we
 * multiply by `dpr` before cropping.
 */
async function cropScreenshot(
  dataUrl: string,
  rectCss: Rect,
  devicePixelRatio: number,
): Promise<Blob> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const dpr = devicePixelRatio || 1;

  // Crop the selected region in physical pixels
  const sx = Math.max(0, Math.round(rectCss.x * dpr));
  const sy = Math.max(0, Math.round(rectCss.y * dpr));
  const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(rectCss.width * dpr)));
  const sh = Math.max(1, Math.min(bmp.height - sy, Math.round(rectCss.height * dpr)));

  const pad = calcPadding(sw, sh);
  const outW = sw + pad * 2;
  const outH = sh + pad * 2;
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");

  // Draw the cropped image in the center
  ctx.drawImage(bmp, sx, sy, sw, sh, pad, pad, sw, sh);

  // Stretch edge pixels to fill padding (adjacent-color padding)
  // Top edge: stretch 1px strip upward
  ctx.drawImage(canvas, pad, pad, sw, 1, pad, 0, sw, pad);
  // Bottom edge: stretch 1px strip downward
  ctx.drawImage(canvas, pad, pad + sh - 1, sw, 1, pad, pad + sh, sw, pad);
  // Left edge: stretch 1px strip leftward (full height including top/bottom pad)
  ctx.drawImage(canvas, pad, 0, 1, outH, 0, 0, pad, outH);
  // Right edge: stretch 1px strip rightward (full height including top/bottom pad)
  ctx.drawImage(canvas, pad + sw - 1, 0, 1, outH, pad + sw, 0, pad, outH);

  bmp.close();
  return canvas.convertToBlob({ type: "image/png" });
}

const PRESET_ID = "standard";

export type RecognizedLine = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Join recognized lines into a single output string, inserting TAB between
 * lines that look like cells on the same row of a table/receipt, and NEWLINE
 * otherwise.
 *
 * Heuristic for "same row":
 *  - Both lines are horizontally oriented (w > h). Vertical Japanese text
 *    yields tall narrow lines (h > w); we never tab-join those because each
 *    "line" is an entire column.
 *  - Their vertical extents overlap by more than half the shorter line's
 *    height. This is tolerant to small detection-noise misalignments while
 *    still rejecting adjacent body paragraph lines.
 *
 * The reading-order pass upstream has already sorted the lines, so we only
 * need to walk them in order and pick the separator for each gap.
 */
export function joinLinesWithRowDetection(
  lines: ReadonlyArray<RecognizedLine>,
): string {
  const valid = lines.filter((l) => l.text.length > 0);
  let out = "";
  for (let i = 0; i < valid.length; i++) {
    const line = valid[i];
    if (i === 0) {
      out = line.text;
      continue;
    }
    const prev = valid[i - 1];
    let sep = "\n";
    const prevHorizontal = prev.w > prev.h;
    const curHorizontal = line.w > line.h;
    if (prevHorizontal && curHorizontal) {
      const overlap =
        Math.min(prev.y + prev.h, line.y + line.h) -
        Math.max(prev.y, line.y);
      const minH = Math.min(prev.h, line.h);
      if (minH > 0 && overlap > minH * 0.5) sep = "\t";
    }
    out += sep + line.text;
  }
  return out;
}

// Offscreen documents cannot use chrome.storage. We delegate the actual
// persistence to the service worker via chrome.runtime.sendMessage. The SW
// also checks the debugMode setting; we always send the crop and let the SW
// decide whether to persist it.
async function sendDebugCropToBackground(blob: Blob): Promise<void> {
  console.log("[ndlocr-lite][debug] sendDebugCropToBackground start, blob size=", blob.size);
  try {
    const bmp = await createImageBitmap(blob);
    const width = bmp.width;
    const height = bmp.height;
    bmp.close();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    console.log("[ndlocr-lite][debug] dataUrl length=", dataUrl.length, "size=", width, "x", height);
    await chrome.runtime.sendMessage({
      target: "background",
      type: "debug-crop-save",
      dataUrl,
      width,
      height,
    });
    console.log("[ndlocr-lite][debug] forwarded crop to background");
  } catch (e) {
    console.warn("[ndlocr-lite][debug] failed to forward debug crop", e);
  }
}

const worker = new OcrWorker();

// Resolve absolute extension URLs (chrome-extension://<id>/...) for the
// model files and pass them to the worker. The worker can't call
// chrome.runtime.getURL itself. The ORT WASM assets are emitted by Vite into
// /assets/ alongside the worker chunk, so onnxruntime-web auto-locates them
// via `import.meta.url` — no `wasmPaths` override needed.
worker.postMessage({
  type: "configure",
  // Empty string → keep onnxruntime-web's default (import.meta.url-relative)
  wasmPaths: "",
  modelUrls: {
    [PRESET_ID]: {
      deim: chrome.runtime.getURL("models/deim-s-1024x1024.onnx"),
      parseq: chrome.runtime.getURL(
        "models/parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx",
      ),
    },
  },
});

// Pre-load models immediately so they're ready when the user triggers OCR.
worker.postMessage({ type: "init", presetId: PRESET_ID });

// True while a user-triggered OCR job is in flight. Pre-warm init messages
// are silently swallowed because there is no content script to display them.
let ocrJobActive = false;

function sendToBackground(msg: OffscreenToBackground): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Background may have been suspended; safe to ignore — content script
    // will time out and show an error toast on its own if results never arrive.
  });
}

worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init-progress": {
      if (!ocrJobActive) break; // pre-warm — no content script to notify
      sendToBackground({
        target: "background",
        type: "ocr-progress",
        progressKey: "init-progress",
        model: msg.model,
        loaded: msg.loaded,
        total: msg.total,
      });
      break;
    }
    case "init-done":
      if (!ocrJobActive) break; // pre-warm
      sendToBackground({
        target: "background",
        type: "ocr-progress",
        progressKey: "init-done",
      });
      break;
    case "detect-done":
      sendToBackground({
        target: "background",
        type: "ocr-progress",
        progressKey: "detect-done",
        numDetections: msg.numDetections,
      });
      break;
    case "recognize-progress":
      sendToBackground({
        target: "background",
        type: "ocr-progress",
        progressKey: "recognize-progress",
        current: msg.current,
        total: msg.total,
      });
      break;
    case "result": {
      const text = joinLinesWithRowDetection(msg.lines);
      sendToBackground({
        target: "background",
        type: "ocr-result",
        text,
      });
      ocrJobActive = false;
      break;
    }
    case "error":
      sendToBackground({
        target: "background",
        type: "ocr-error",
        message: msg.message,
      });
      ocrJobActive = false;
      break;
  }
};

// Receive run requests from the background service worker.
chrome.runtime.onMessage.addListener((message: AnyMessage) => {
  if (!message || (message as { target?: string }).target !== "offscreen") return;
  const msg = message as BackgroundToOffscreen;
  if (msg.type === "run-ocr") {
    ocrJobActive = true;
    void (async () => {
      try {
        const blob = await cropScreenshot(
          msg.screenshotDataUrl,
          msg.rect,
          msg.devicePixelRatio,
        );
        // Fire-and-forget: never block the OCR pipeline on debug save.
        // We also slice() the blob to give the save path its own buffer view,
        // so any concurrent read can't interact with the worker's decode.
        void sendDebugCropToBackground(blob.slice(0, blob.size, blob.type));
        worker.postMessage({ type: "run", imageBlob: blob, presetId: PRESET_ID });
      } catch (e) {
        sendToBackground({
          target: "background",
          type: "ocr-error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }
});
