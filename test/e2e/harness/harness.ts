import OcrWorker from "../../../src/ocr/worker/ocr.worker.ts?worker";
import type {
  WorkerMessage,
  WorkerResponse,
} from "../../../src/ocr/worker/ocr.worker";
import { DEFAULT_PRESET_ID } from "../../../src/ocr/config/model-config";
import { joinLinesWithRowDetection } from "../../../src/shared/join-lines";

type OcrLine = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
};

type OcrResult = {
  text: string;
  lines: OcrLine[];
};

const status = document.getElementById("status")!;
const worker = new OcrWorker();

const origin = window.location.origin;
const modelUrls: Record<string, { deim: string; parseq: string }> = {
  standard: {
    deim: `${origin}/models/deim-s-1024x1024.onnx`,
    parseq: `${origin}/models/parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx`,
  },
};

const post = (m: WorkerMessage) => worker.postMessage(m);

let ready = false;
const readyPromise = new Promise<void>((resolve, reject) => {
  const onMsg = (e: MessageEvent<WorkerResponse>) => {
    if (e.data.type === "init-done") {
      ready = true;
      status.textContent = "ready";
      worker.removeEventListener("message", onMsg);
      resolve();
    } else if (e.data.type === "error") {
      status.textContent = `error: ${e.data.message}`;
      worker.removeEventListener("message", onMsg);
      reject(new Error(e.data.message));
    } else if (e.data.type === "init-progress") {
      status.textContent = `loading ${e.data.model} ${e.data.loaded}/${e.data.total ?? "?"}`;
    }
  };
  worker.addEventListener("message", onMsg);
});

post({ type: "configure", wasmPaths: "", modelUrls });
post({ type: "init", presetId: DEFAULT_PRESET_ID });

async function runOcr(bytes: Uint8Array): Promise<OcrResult> {
  await readyPromise;
  const imageBlob = new Blob([bytes], { type: "image/png" });
  return new Promise<OcrResult>((resolve, reject) => {
    const onMsg = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.type === "result") {
        worker.removeEventListener("message", onMsg);
        const text = joinLinesWithRowDetection(e.data.lines);
        resolve({ text, lines: e.data.lines });
      } else if (e.data.type === "error") {
        worker.removeEventListener("message", onMsg);
        reject(new Error(e.data.message));
      }
    };
    worker.addEventListener("message", onMsg);
    post({ type: "run", imageBlob, presetId: DEFAULT_PRESET_ID });
  });
}

declare global {
  interface Window {
    __ocr: {
      isReady: () => boolean;
      whenReady: () => Promise<void>;
      run: (bytes: Uint8Array | number[]) => Promise<OcrResult>;
    };
  }
}

window.__ocr = {
  isReady: () => ready,
  whenReady: () => readyPromise,
  run: (bytes) =>
    runOcr(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
};
