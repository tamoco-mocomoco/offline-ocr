/**
 * Web Worker: OCR Pipeline
 *
 * Receives an image, runs detection → parse → reading order → recognition,
 * and posts results back to the main thread.
 */

import * as ort from "onnxruntime-web/wasm";
import { DEIMDetector, type Detection } from "../engine/deim";
import { PARSeqRecognizer } from "../engine/parseq";
import { cropImageData, decodeImage } from "../engine/image-utils";
import {
  detectionsToPage,
  findAll,
  createElement,
  type Element,
} from "../parser/ndl-parser";
import { evalPage } from "../reading-order/eval";
import { fetchModel } from "../storage/model-cache";
import {
  MODEL_PRESETS,
  DEFAULT_PRESET_ID,
  type ModelPreset,
} from "../config/model-config";

// Message types
export type WorkerMessage =
  | {
      type: "configure";
      wasmPaths: string;
      modelUrls: Record<string, { deim: string; parseq: string }>;
    }
  | { type: "run"; imageBlob: Blob; presetId: string }
  | { type: "init"; presetId: string };

export type WorkerResponse =
  | { type: "init-progress"; model: string; loaded: number; total: number }
  | { type: "init-done" }
  | { type: "detect-done"; numDetections: number }
  | { type: "recognize-progress"; current: number; total: number }
  | {
      type: "result";
      lines: {
        text: string;
        x: number;
        y: number;
        w: number;
        h: number;
        conf: number;
      }[];
      detections: Detection[];
      page: Element;
    }
  | { type: "error"; message: string };

let detector: DEIMDetector | null = null;
let recognizer: PARSeqRecognizer | null = null;
let currentPresetId: string | null = null;
let modelUrlOverrides: Record<string, { deim: string; parseq: string }> = {};
let configured = false;

function post(msg: WorkerResponse): void {
  self.postMessage(msg);
}

function getPreset(presetId: string): ModelPreset {
  const base =
    MODEL_PRESETS.find((p) => p.id === presetId) ??
    MODEL_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!;
  const override = modelUrlOverrides[base.id];
  if (!override) return base;
  return {
    ...base,
    deim: { ...base.deim, url: override.deim },
    parseq: { ...base.parseq, url: override.parseq },
  };
}

async function initModels(presetId: string): Promise<void> {
  const preset = getPreset(presetId);

  if (currentPresetId === preset.id && detector && recognizer) {
    post({ type: "init-done" });
    return;
  }

  detector?.dispose();
  recognizer?.dispose();
  detector = new DEIMDetector();
  recognizer = new PARSeqRecognizer();

  const deimBuffer = await fetchModel(
    preset.deim.url,
    preset.deim.name,
    (loaded, total) =>
      post({ type: "init-progress", model: "DEIM", loaded, total }),
  );
  await detector.init(deimBuffer, preset.deim);

  const parseqBuffer = await fetchModel(
    preset.parseq.url,
    preset.parseq.name,
    (loaded, total) =>
      post({ type: "init-progress", model: "PARSeq", loaded, total }),
  );
  await recognizer.init(parseqBuffer, preset.parseq);

  currentPresetId = preset.id;
  post({ type: "init-done" });
}

// ---------------------------------------------------------------------------
// Recognition with long-line splitting
// ---------------------------------------------------------------------------

const SPLIT_CHAR_THRESHOLD = 98;

/**
 * Recognize a line image, splitting it in half if the result maxes out
 * the model's capacity (~100 chars).
 */
async function recognizeLine(lineImg: ImageData): Promise<string> {
  const text = await recognizer!.read(lineImg);
  if (text.length < SPLIT_CHAR_THRESHOLD) return text;

  const isVertical = lineImg.height > lineImg.width;
  if (isVertical) {
    const mid = Math.floor(lineImg.height / 2);
    const top = cropImageData(lineImg, 0, 0, lineImg.width, mid);
    const bottom = cropImageData(
      lineImg,
      0,
      mid,
      lineImg.width,
      lineImg.height - mid,
    );
    return (await recognizer!.read(top)) + (await recognizer!.read(bottom));
  } else {
    const mid = Math.floor(lineImg.width / 2);
    const left = cropImageData(lineImg, 0, 0, mid, lineImg.height);
    const right = cropImageData(
      lineImg,
      mid,
      0,
      lineImg.width - mid,
      lineImg.height,
    );
    return (await recognizer!.read(left)) + (await recognizer!.read(right));
  }
}

// ---------------------------------------------------------------------------
// Main OCR pipeline
// ---------------------------------------------------------------------------

async function runOcr(imageBlob: Blob, presetId: string): Promise<void> {
  try {
    await initModels(presetId);

    const imageData = await decodeImage(imageBlob);
    const imgW = imageData.width;
    const imgH = imageData.height;

    const detections = await detector!.detect(imageData);
    post({ type: "detect-done", numDetections: detections.length });

    const page = detectionsToPage(imgW, imgH, "input.jpg", detections);
    const root = createElement("OCRDATASET", {}, [page]);
    evalPage(root, true);

    const lines = findAll(page, "LINE");
    const total = lines.length;

    const resultLines: {
      text: string;
      x: number;
      y: number;
      w: number;
      h: number;
      conf: number;
    }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const x = parseInt(line.attrs.X ?? "0");
      const y = parseInt(line.attrs.Y ?? "0");
      const w = parseInt(line.attrs.WIDTH ?? "0");
      const h = parseInt(line.attrs.HEIGHT ?? "0");
      const conf = parseFloat(line.attrs.CONF ?? "0");

      if (w <= 0 || h <= 0) {
        resultLines.push({ text: "", x, y, w, h, conf });
        continue;
      }

      const lineImg = cropImageData(imageData, x, y, w, h);
      const text = await recognizeLine(lineImg);
      line.attrs.STRING = text;
      resultLines.push({ text, x, y, w, h, conf });

      if ((i + 1) % 5 === 0 || i === total - 1) {
        post({ type: "recognize-progress", current: i + 1, total });
      }
    }

    post({ type: "result", lines: resultLines, detections, page });
  } catch (e) {
    post({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;
  if (msg.type === "configure") {
    if (msg.wasmPaths) {
      ort.env.wasm.wasmPaths = msg.wasmPaths;
    }
    ort.env.wasm.numThreads = 1;
    modelUrlOverrides = msg.modelUrls;
    configured = true;
    return;
  }
  if (!configured) {
    post({
      type: "error",
      message: "Worker received run/init before configure",
    });
    return;
  }
  if (msg.type === "init") {
    try {
      await initModels(msg.presetId);
    } catch (err) {
      post({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (msg.type === "run") {
    await runOcr(msg.imageBlob, msg.presetId);
  }
};
