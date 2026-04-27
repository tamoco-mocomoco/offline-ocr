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
      // Join recognized lines in reading order. The reading-order pass already
      // sorts top-to-bottom / right-to-left as appropriate for Japanese.
      const text = msg.lines
        .map((l) => l.text)
        .filter((t) => t.length > 0)
        .join("\n");
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
