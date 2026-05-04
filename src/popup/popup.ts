/**
 * Popup entrypoint.
 */

const t = chrome.i18n.getMessage;

// Apply data-i18n attributes
document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
  const key = el.dataset.i18n!;
  el.textContent = t(key);
});

function setStatus(text: string): void {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

// Build description with dynamic shortcut key
chrome.commands.getAll((commands) => {
  const cmd = commands.find((c) => c.name === "start-ocr");
  const shortcut = cmd?.shortcut || "Alt+Shift+O";
  const descEl = document.getElementById("popup-desc");
  if (descEl) {
    descEl.innerHTML = t("popupDescription", [
      `<kbd>${shortcut}</kbd>`,
    ]);
  }
});

async function startSelectionFromPopup(): Promise<void> {
  setStatus(t("statusLoading"));
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (!tab?.id) {
      setStatus(t("statusNoActiveTab"));
      return;
    }
    if (
      tab.url &&
      (tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("https://chromewebstore.google.com") ||
        tab.url.startsWith("https://chrome.google.com/webstore"))
    ) {
      setStatus(t("statusCannotRun"));
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    await chrome.tabs.sendMessage(tab.id, {
      target: "content",
      type: "start-selection",
    });
    window.close();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(t("statusError", [msg]));
    console.error("[ndlocr-lite popup]", e);
  }
}

const startBtn = document.getElementById("start") as HTMLButtonElement | null;
if (!startBtn) {
  setStatus(t("statusStartButtonNotFound"));
} else {
  startBtn.addEventListener("click", () => {
    void startSelectionFromPopup();
  });
}

document.getElementById("open-options")?.addEventListener("click", (ev) => {
  ev.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

// ── Paste clipboard image for OCR ──

document.getElementById("paste-clipboard")?.addEventListener("click", async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (imageType) {
        setStatus(t("statusLoading"));
        const blob = await item.getType(imageType);
        const reader = new FileReader();
        reader.onload = async () => {
          await chrome.storage.session.set({ viewerImage: reader.result as string });
          await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
          window.close();
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
    setStatus(t("statusNoClipboardImage"));
  } catch {
    setStatus(t("statusNoClipboardImage"));
  }
});

// ── Open local file for OCR ──

const fileInput = document.getElementById("file-input") as HTMLInputElement;

document.getElementById("open-file")?.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  setStatus(t("statusLoading"));
  const reader = new FileReader();
  reader.onload = async () => {
    // session storage is in-memory only, cleared when browser closes
    await chrome.storage.session.set({ viewerImage: reader.result as string });
    await chrome.tabs.create({ url: chrome.runtime.getURL("viewer.html") });
    window.close();
  };
  reader.readAsDataURL(file);
});
