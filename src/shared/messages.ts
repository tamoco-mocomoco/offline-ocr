/**
 * Message contracts between content script ↔ background service worker ↔
 * offscreen document.
 *
 * All messages are sent via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`.
 * The `target` field disambiguates routing because all extension contexts share
 * a single message bus.
 */

export type Rect = {
  // CSS pixel coordinates relative to the visible viewport (not the page).
  x: number;
  y: number;
  width: number;
  height: number;
};

// content / viewer → background
export type ContentToBackground =
  | {
      target: "background";
      type: "selection-completed";
      rect: Rect;
      devicePixelRatio: number;
    }
  | {
      target: "background";
      type: "selection-cancelled";
    }
  | {
      target: "background";
      type: "viewer-ocr-start";
      tabId: number;
    };

// background → content
export type BackgroundToContent =
  | { target: "content"; type: "start-selection" }
  | { target: "content"; type: "ocr-progress"; phase: string; current?: number; total?: number }
  | { target: "content"; type: "ocr-result"; text: string }
  | { target: "content"; type: "ocr-error"; message: string };

// background → offscreen
//
// We pass the full visible-tab screenshot as a data URL (string) plus the
// crop rect. chrome.runtime.sendMessage cannot reliably transport binary
// types like ArrayBuffer/Blob — they get JSON-serialized into objects with
// numeric keys, which corrupts the image. Strings round-trip safely.
export type BackgroundToOffscreen = {
  target: "offscreen";
  type: "run-ocr";
  screenshotDataUrl: string;
  rect: Rect;
  devicePixelRatio: number;
};

// offscreen → background
//
// The offscreen document does NOT have access to chrome.i18n, so progress
// messages carry a `progressKey` and raw data instead of pre-localized strings.
// The background service worker translates them into localized `phase` strings
// before forwarding to the content script.
export type OffscreenToBackground =
  | {
      target: "background";
      type: "ocr-progress";
      progressKey: "init-progress";
      model: string;
      loaded: number;
      total: number;
    }
  | { target: "background"; type: "ocr-progress"; progressKey: "init-done" }
  | {
      target: "background";
      type: "ocr-progress";
      progressKey: "detect-done";
      numDetections: number;
    }
  | {
      target: "background";
      type: "ocr-progress";
      progressKey: "recognize-progress";
      current: number;
      total: number;
    }
  | { target: "background"; type: "ocr-result"; text: string }
  | { target: "background"; type: "ocr-error"; message: string };

export type AnyMessage =
  | ContentToBackground
  | BackgroundToContent
  | BackgroundToOffscreen
  | OffscreenToBackground;
