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
