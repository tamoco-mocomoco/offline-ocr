/**
 * Background service worker (MV3).
 *
 * Responsibilities:
 *  - React to user-triggered launches (toolbar action click, keyboard command,
 *    context menu) and inject the content script with a `start-selection`
 *    message.
 *  - On `selection-completed`, capture the visible tab via
 *    `chrome.tabs.captureVisibleTab`, crop the selected rect via
 *    OffscreenCanvas, and forward the PNG bytes to the offscreen document.
 *  - Relay OCR progress / result / error messages from the offscreen document
 *    back to the originating tab's content script.
 *
 * The offscreen document hosts the actual ONNX OCR Web Worker — see
 * `src/offscreen/offscreen.ts`.
 */

import type {
  AnyMessage,
  BackgroundToContent,
  ContentToBackground,
  OffscreenToBackground,
} from "../shared/messages";
const OFFSCREEN_PATH = "offscreen.html";
const CONTEXT_MENU_ID = "ndlocr-lite-start";

// Tracks which tab is currently mid-OCR so we can route results back to it.
// Only one job runs at a time across the whole extension.
let activeOcrTabId: number | null = null;

// ---- Lifecycle ----------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: chrome.i18n.getMessage("contextMenuTitle"),
    contexts: ["page", "selection", "image", "frame"],
  });
  // Pre-warm: create the offscreen document so the OCR worker starts loading
  // models immediately. By the time the user triggers OCR, the models are
  // likely already loaded (IndexedDB cache + InferenceSession creation).
  void ensureOffscreenDocument();
});

// Also pre-warm when the service worker restarts (e.g. after idle suspension).
chrome.runtime.onStartup.addListener(() => {
  void ensureOffscreenDocument();
});

// ---- Launch entry points ------------------------------------------------

chrome.action.onClicked.addListener((tab) => {
  // The default_popup in manifest.json takes precedence; this only fires when
  // the popup is unset (e.g. via popup.html → "OCRを開始" button delegating
  // here). Kept for safety.
  if (tab.id != null) startSelection(tab.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "start-ocr") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) startSelection(tab.id);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  if (tab?.id != null) startSelection(tab.id);
});

// Allow the popup to trigger a selection without inheriting the action click.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if ((message as { type?: string }).type === "popup-start-selection") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id != null) startSelection(tab.id);
      sendResponse({ ok: true });
    });
    return true; // async sendResponse
  }
  return false;
});

async function startSelection(tabId: number): Promise<void> {
  try {
    // Inject the content script. Idempotent: the script itself guards against
    // double initialization with a window flag.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await chrome.tabs.sendMessage(tabId, {
      target: "content",
      type: "start-selection",
    } satisfies BackgroundToContent);
  } catch (e) {
    console.warn("[ndlocr-lite] failed to start selection", e);
  }
}

// ---- Message routing ----------------------------------------------------

chrome.runtime.onMessage.addListener((message: AnyMessage, sender) => {
  if (!message || typeof message !== "object") return;
  const target = (message as { target?: string }).target;

  if (target === "background") {
    // Could come from either content script or offscreen document.
    if ("type" in message && message.type === "selection-completed") {
      const tabId = sender.tab?.id;
      if (tabId != null) {
        void handleSelectionCompleted(tabId, message);
      }
    } else if ("type" in message && message.type === "selection-cancelled") {
      // Nothing to do; selector cleaned itself up.
    } else if (
      "type" in message &&
      (message.type === "ocr-progress" ||
        message.type === "ocr-result" ||
        message.type === "ocr-error")
    ) {
      forwardOcrEventToContent(message as OffscreenToBackground);
    }
  }
});

async function handleSelectionCompleted(
  tabId: number,
  message: Extract<ContentToBackground, { type: "selection-completed" }>,
): Promise<void> {
  activeOcrTabId = tabId;
  try {
    // captureVisibleTab is restricted by activeTab to the focused window.
    const winId = (await chrome.tabs.get(tabId)).windowId;
    const dataUrl = await chrome.tabs.captureVisibleTab(winId, {
      format: "png",
    });

    await ensureOffscreenDocument();
    // Send the full screenshot as a data URL (string) plus the rect. The
    // offscreen document does the actual cropping and image decoding because
    // chrome.runtime.sendMessage cannot reliably transport binary payloads.
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "run-ocr",
      screenshotDataUrl: dataUrl,
      rect: message.rect,
      devicePixelRatio: message.devicePixelRatio,
    });
    sendToContent(tabId, {
      target: "content",
      type: "ocr-progress",
      phase: chrome.i18n.getMessage("progressOcrRunning"),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    sendToContent(tabId, {
      target: "content",
      type: "ocr-error",
      message: chrome.i18n.getMessage("errorCaptureFailed", [message]),
    });
    activeOcrTabId = null;
  }
}

function localizeProgress(msg: Extract<OffscreenToBackground, { type: "ocr-progress" }>): {
  phase: string;
  current?: number;
  total?: number;
} {
  const t = chrome.i18n.getMessage;
  switch (msg.progressKey) {
    case "init-progress": {
      const pct = msg.total > 0 ? Math.round((msg.loaded / msg.total) * 100) : 0;
      return { phase: t("progressLoading", [msg.model, String(pct)]), current: msg.loaded, total: msg.total };
    }
    case "init-done":
      return { phase: t("progressModelReady") };
    case "detect-done":
      return { phase: t("progressDetected", [String(msg.numDetections)]) };
    case "recognize-progress":
      return { phase: t("progressRecognizing"), current: msg.current, total: msg.total };
  }
}

function forwardOcrEventToContent(msg: OffscreenToBackground): void {
  if (activeOcrTabId == null) return;
  const tabId = activeOcrTabId;
  if (msg.type === "ocr-progress") {
    const { phase, current, total } = localizeProgress(msg);
    sendToContent(tabId, {
      target: "content",
      type: "ocr-progress",
      phase,
      current,
      total,
    });
  } else if (msg.type === "ocr-result") {
    sendToContent(tabId, {
      target: "content",
      type: "ocr-result",
      text: msg.text,
    });
    activeOcrTabId = null;
  } else if (msg.type === "ocr-error") {
    sendToContent(tabId, {
      target: "content",
      type: "ocr-error",
      message: msg.message,
    });
    activeOcrTabId = null;
  }
}

function sendToContent(tabId: number, msg: BackgroundToContent): void {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {
    // Tab may have been closed; safe to ignore.
  });
}

// ---- Offscreen document management --------------------------------------

async function ensureOffscreenDocument(): Promise<void> {
  // Check via chrome.runtime.getContexts (Chrome 116+). The older
  // chrome.offscreen.hasDocument is not always typed; getContexts is the
  // forward-compatible API.
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["WORKERS" as chrome.offscreen.Reason],
    justification:
      chrome.i18n.getMessage("offscreenJustification"),
  });
}
