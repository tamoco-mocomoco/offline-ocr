/**
 * Model presets for the ndlocr-lite OCR pipeline.
 *
 * NOTE for the Chrome-extension port: the URLs are NOT baked in here because
 * the Web Worker that consumes this config has no access to `chrome.runtime`.
 * Instead, the offscreen document resolves absolute `chrome-extension://` URLs
 * at runtime via `chrome.runtime.getURL()` and overrides them in a `configure`
 * message before the first `run`. The `url` field below is just a relative
 * path inside the extension package and is the default if no override is set.
 */
export interface ModelConfig {
  url: string;
  inputShape: number[];
  name: string;
}

export interface ModelPreset {
  id: string;
  label: string;
  description: string;
  deim: ModelConfig;
  parseq: ModelConfig;
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "standard",
    label: "標準 (77MB)",
    description: "FP32 — 最高精度",
    deim: {
      url: "models/deim-s-1024x1024.onnx",
      inputShape: [1, 3, 800, 800],
      name: "deim-s-1024x1024.onnx",
    },
    parseq: {
      url: "models/parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx",
      inputShape: [1, 3, 16, 768],
      name: "parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx",
    },
  },
];

export const DEFAULT_PRESET_ID = "standard";

export const DET_CONF_THRESHOLD = 0.25;
export const DET_SCORE_THRESHOLD = 0.2;
