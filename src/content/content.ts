/**
 * Content script — runs in the page's isolated world.
 *
 * Responsibilities:
 *  - Draw a fullscreen selection overlay on demand and report the chosen rect
 *    back to the background service worker.
 *  - Display a small toast for OCR progress / errors / success.
 *  - Write the final OCR text to the clipboard via `navigator.clipboard.writeText`.
 *
 * Idempotency: this file is injected via `chrome.scripting.executeScript`,
 * which may re-inject on every launch. We guard with a global flag so we don't
 * register message listeners twice.
 */

// NOTE: content scripts injected via chrome.scripting.executeScript run as
// classic scripts, NOT ES modules. Any `import` would be code-split by Vite
// into a separate chunk that can't be loaded. So we inline everything we need.

// --- Inline: cleaning rule types & helpers (from shared/cleaning.ts) --------

interface CleaningRule {
  id: string;
  name: string;
  comment?: string;
  pattern: string;
  flags: string;
  replacement: string;
  enabled: boolean;
}

const CLEANING_STORAGE_KEY = "cleaningRules";
const SETTINGS_STORAGE_KEY = "settings";

interface Settings {
  showResultAlert?: boolean;
}

async function loadRules(): Promise<CleaningRule[]> {
  const obj = await chrome.storage.sync.get(CLEANING_STORAGE_KEY);
  const rules = obj?.[CLEANING_STORAGE_KEY];
  return Array.isArray(rules) ? (rules as CleaningRule[]) : [];
}

async function loadSettings(): Promise<Settings> {
  const obj = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY);
  return (obj?.[SETTINGS_STORAGE_KEY] as Settings) ?? {};
}

function applyCleaningRules(text: string, rules: CleaningRule[]): string {
  let out = text;
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue;
    try {
      const re = new RegExp(rule.pattern, rule.flags || "");
      out = out.replace(re, rule.replacement);
    } catch {
      // skip invalid regex
    }
  }
  return out;
}

// --- Inline: message types (from shared/messages.ts) ------------------------

type Rect = { x: number; y: number; width: number; height: number };

type BackgroundToContent =
  | { target: "content"; type: "start-selection" }
  | { target: "content"; type: "ocr-progress"; phase: string; current?: number; total?: number }
  | { target: "content"; type: "ocr-result"; text: string }
  | { target: "content"; type: "ocr-error"; message: string };

(function init() {
  const t = chrome.i18n.getMessage;
  // Guard against duplicate injection. However, if the extension was reloaded
  // the old content script context is dead (chrome.runtime disconnected) and
  // the flag is stale — we must re-initialize in that case.
  if ((window as any).__ndlocrLiteInjected) {
    try {
      // This throws if the extension context is invalidated (e.g. after reload).
      void chrome.runtime.id;
      return; // Still alive — skip re-init.
    } catch {
      // Extension context dead — fall through and re-initialize.
    }
  }
  (window as any).__ndlocrLiteInjected = true;

  // ---- Toast UI ---------------------------------------------------------

  let toastEl: HTMLDivElement | null = null;
  let toastHideTimer: number | null = null;

  function ensureToast(): HTMLDivElement {
    if (toastEl && document.body.contains(toastEl)) return toastEl;
    const el = document.createElement("div");
    el.setAttribute("data-ndlocr-lite", "toast");
    Object.assign(el.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      maxWidth: "360px",
      padding: "10px 14px",
      background: "rgba(20, 20, 20, 0.92)",
      color: "#fff",
      font: "13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      borderRadius: "8px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
      zIndex: "2147483647",
      pointerEvents: "none",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      transition: "opacity 0.2s",
      opacity: "0",
    } as CSSStyleDeclaration);
    document.body.appendChild(el);
    toastEl = el;
    return el;
  }

  function showToast(text: string, opts: { autoHideMs?: number } = {}): void {
    const el = ensureToast();
    el.textContent = text;
    el.style.opacity = "1";
    if (toastHideTimer != null) window.clearTimeout(toastHideTimer);
    if (opts.autoHideMs != null) {
      toastHideTimer = window.setTimeout(() => {
        el.style.opacity = "0";
      }, opts.autoHideMs);
    }
  }

  // ---- Selection overlay ------------------------------------------------

  let overlayRoot: HTMLDivElement | null = null;
  let selecting = false;

  function startSelection(): void {
    if (selecting) return;
    selecting = true;
    showToast(t("toastSelectionInstruction"), {
      autoHideMs: 4000,
    });

    const root = document.createElement("div");
    root.setAttribute("data-ndlocr-lite", "overlay");
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      cursor: "crosshair",
      zIndex: "2147483646",
      // Slight tint so the user knows selection mode is active.
      background: "rgba(0, 0, 0, 0.25)",
    } as CSSStyleDeclaration);

    const rectEl = document.createElement("div");
    Object.assign(rectEl.style, {
      position: "fixed",
      border: "2px solid #4ea3ff",
      background: "rgba(78, 163, 255, 0.15)",
      pointerEvents: "none",
      display: "none",
    } as CSSStyleDeclaration);
    root.appendChild(rectEl);

    document.body.appendChild(root);
    overlayRoot = root;

    let startX = 0;
    let startY = 0;
    let dragging = false;

    function updateRect(curX: number, curY: number): Rect {
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);
      rectEl.style.display = "block";
      rectEl.style.left = `${x}px`;
      rectEl.style.top = `${y}px`;
      rectEl.style.width = `${width}px`;
      rectEl.style.height = `${height}px`;
      return { x, y, width, height };
    }

    function onMouseDown(ev: MouseEvent) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      dragging = true;
      startX = ev.clientX;
      startY = ev.clientY;
      updateRect(ev.clientX, ev.clientY);
    }
    function onMouseMove(ev: MouseEvent) {
      if (!dragging) return;
      updateRect(ev.clientX, ev.clientY);
    }
    function onMouseUp(ev: MouseEvent) {
      if (!dragging) return;
      dragging = false;
      const rect = updateRect(ev.clientX, ev.clientY);
      cleanup();
      if (rect.width < 4 || rect.height < 4) {
        // Treat tiny selections as accidental click → cancel silently
        sendCancelled();
        return;
      }
      chrome.runtime
        .sendMessage({
          target: "background",
          type: "selection-completed",
          rect,
          devicePixelRatio: window.devicePixelRatio || 1,
        })
        .catch(() => {
          showToast(t("toastCommunicationError"), { autoHideMs: 3000 });
        });
      showToast(t("toastCapturing"));
    }
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        cleanup();
        sendCancelled();
        showToast(t("toastSelectionCancelled"), { autoHideMs: 1500 });
      }
    }

    function cleanup() {
      selecting = false;
      root.remove();
      overlayRoot = null;
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("keydown", onKeyDown, true);
    }

    function sendCancelled() {
      chrome.runtime
        .sendMessage({ target: "background", type: "selection-cancelled" })
        .catch(() => {});
    }

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("keydown", onKeyDown, true);
  }

  // ---- Clipboard --------------------------------------------------------

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback: hidden textarea + execCommand for pages where the Async
      // Clipboard API is blocked (e.g. iframes without focus).
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  // ---- Message handling -------------------------------------------------

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!message || (message as { target?: string }).target !== "content") return;
    const msg = message as BackgroundToContent;
    switch (msg.type) {
      case "start-selection":
        startSelection();
        break;
      case "ocr-progress": {
        let txt = msg.phase;
        if (msg.current != null && msg.total != null && msg.total > 0) {
          txt += ` (${msg.current}/${msg.total})`;
        }
        showToast(txt);
        break;
      }
      case "ocr-result": {
        const rawText = msg.text;
        if (!rawText) {
          showToast(t("toastNoTextDetected"), { autoHideMs: 2500 });
          loadSettings().catch(() => ({} as Settings)).then((settings) => {
            if (settings.showResultAlert ?? true) {
              window.alert(t("toastNoTextDetected"));
            }
          });
          return;
        }
        // Apply user-defined regex cleaning rules from chrome.storage.sync.
        // If loading fails for any reason we fall back to the raw text.
        Promise.all([
          loadRules().catch(() => [] as CleaningRule[]),
          loadSettings().catch(() => ({} as Settings)),
        ])
          .then(([rules, settings]) => {
            // Trim each line and the overall result — PARSeq sometimes
            // appends padding spaces or trailing whitespace to recognized text.
            const cleaned = applyCleaningRules(rawText, rules)
              .split("\n")
              .map((line) => line.trimEnd())
              .join("\n")
              .trim();
            return copyToClipboard(cleaned).then((ok) => ({
              ok,
              text: cleaned,
              showAlert: settings.showResultAlert ?? true,
            }));
          })
          .then(({ ok, text, showAlert }) => {
            const len = text.length;
            if (ok) {
              showToast(t("toastCopied", [String(len)]), { autoHideMs: 2500 });
            } else {
              showToast(
                `${t("toastClipboardFailed")}\n${t("toastRecognitionResult")}\n${text}`,
                { autoHideMs: 8000 },
              );
            }
            if (showAlert) {
              const header = ok
                ? t("alertResultCopied", [String(len)])
                : t("alertResultCopyFailed", [String(len)]);
              window.alert(`${header}\n\n${text}`);
            }
          });
        break;
      }
      case "ocr-error":
        showToast(t("errorPrefix", [msg.message]), { autoHideMs: 5000 });
        break;
    }
  });
})();
