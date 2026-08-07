/**
 * Web Worker: OCR Pipeline
 *
 * Receives an image, runs detection → parse → reading order → recognition,
 * and posts results back to the main thread.
 */

import * as ort from "onnxruntime-web/wasm";
import { DEIMDetector, type Detection } from "../engine/deim";
import { PARSeqRecognizer } from "../engine/parseq";
import {
  cropImageData,
  decodeImage,
  trimEdgeColor,
  dominantBorderColor,
  extractMainTextBand,
} from "../engine/image-utils";
import {
  detectionsToPage,
  findAll,
  createElement,
  type Element,
} from "../parser/ndl-parser";
import { filterFurigana } from "../parser/furigana-filter";
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

    // タイトに切り取られた小さなキャプチャ (例: コミットハッシュ) は DEIM の
    // 検出スコアがしきい値を下回るため、検出をスキップして PARSeq に直接渡す。
    const SMALL_IMAGE_BYPASS_MAX_SIDE = 200;
    if (Math.max(imgW, imgH) <= SMALL_IMAGE_BYPASS_MAX_SIDE) {
      // 背景色は border 全体から dominant を集計 (1 pixel だけ見ると断片を
      // 拾ってしまうため)。その色を基準に、上下の隣接行フラグメントを弾いて
      // 本文行の帯だけを抽出してから、左右の余白を trim して PARSeq に渡す。
      const bg = dominantBorderColor(imageData);
      const band = extractMainTextBand(imageData, bg);
      const trimmed = trimEdgeColor(band);
      const text = await recognizer!.read(trimmed, true);
      post({ type: "detect-done", numDetections: 1 });
      post({
        type: "result",
        lines: [{ text, x: 0, y: 0, w: imgW, h: imgH, conf: 1 }],
        detections: [],
        page: createElement("PAGE", {
          WIDTH: String(imgW),
          HEIGHT: String(imgH),
        }),
      });
      return;
    }

    const detections = await detector!.detect(imageData);
    post({ type: "detect-done", numDetections: detections.length });

    const page = detectionsToPage(imgW, imgH, "input.jpg", detections);
    const root = createElement("OCRDATASET", {}, [page]);
    evalPage(root, true);

    const allLines = findAll(page, "LINE");
    const lineBoxes = allLines.map((line) => ({
      x: parseInt(line.attrs.X ?? "0"),
      y: parseInt(line.attrs.Y ?? "0"),
      width: parseInt(line.attrs.WIDTH ?? "0"),
      height: parseInt(line.attrs.HEIGHT ?? "0"),
      line,
    }));
    const lines = filterFurigana(lineBoxes).map((b) => b.line);
    const total = lines.length;

    type LineResult = {
      text: string;
      x: number;
      y: number;
      w: number;
      h: number;
      conf: number;
    };
    // Sized array so we can write results out of order and keep the reading
    // order determined by the upstream evalPage/filterFurigana pass.
    const resultLines: LineResult[] = new Array(total);

    // Run PARSeq for each detected line with bounded concurrency. Even when
    // ORT serializes on a single WASM thread this is a wash (never slower),
    // and on WebGPU multiple lines can overlap on the GPU. Concurrency is
    // capped so a page with many lines doesn't blow memory.
    const PARSEQ_CONCURRENCY = 4;
    let completed = 0;

    const processLine = async (idx: number): Promise<void> => {
      const line = lines[idx];
      const x = parseInt(line.attrs.X ?? "0");
      const y = parseInt(line.attrs.Y ?? "0");
      const w = parseInt(line.attrs.WIDTH ?? "0");
      const h = parseInt(line.attrs.HEIGHT ?? "0");
      const conf = parseFloat(line.attrs.CONF ?? "0");
      if (w <= 0 || h <= 0) {
        resultLines[idx] = { text: "", x, y, w, h, conf };
      } else {
        const lineImg = cropImageData(imageData, x, y, w, h);
        const text = await recognizeLine(lineImg);
        line.attrs.STRING = text;
        resultLines[idx] = { text, x, y, w, h, conf };
      }
      completed++;
      if (completed % 5 === 0 || completed === total) {
        post({
          type: "recognize-progress",
          current: completed,
          total,
        });
      }
    };

    // Simple worker-pool pattern: shared index counter, `min(N, total)`
    // workers each pull the next line.
    let next = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const idx = next++;
        if (idx >= total) return;
        await processLine(idx);
      }
    };
    const workerCount = Math.min(PARSEQ_CONCURRENCY, Math.max(total, 1));
    await Promise.all(
      Array.from({ length: workerCount }, () => worker()),
    );

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
