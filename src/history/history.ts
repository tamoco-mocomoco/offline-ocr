/**
 * History page entrypoint.
 *
 * 履歴一覧の表示・検索・コピー・編集・削除を行う。データは
 * `chrome.storage.local` 上の `ocrHistory` キーに保存されている。
 */

import {
  clearHistory,
  deleteHistoryItem,
  listHistory,
  updateHistoryItem,
  type OcrHistoryItem,
} from "../shared/ocr-history";

const t = chrome.i18n.getMessage;

let items: OcrHistoryItem[] = [];
let searchQuery = "";
let editingId: string | null = null;
let expandedIds = new Set<string>();

function flash(message: string): void {
  const el = document.getElementById("flash")!;
  el.textContent = message;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 1600);
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 1 ? u.pathname : "");
  } catch {
    return url;
  }
}

function filteredItems(): OcrHistoryItem[] {
  if (!searchQuery) return items;
  const q = searchQuery.toLowerCase();
  return items.filter(
    (it) =>
      it.text.toLowerCase().includes(q) ||
      (it.url ?? "").toLowerCase().includes(q) ||
      (it.pageTitle ?? "").toLowerCase().includes(q),
  );
}

function focusFromHash(): string | null {
  const m = window.location.hash.match(/^#focus=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    flash(t("historyCopiedFlash"));
  } catch {
    flash(t("historyCopyFailedFlash"));
  }
}

function render(): void {
  const root = document.getElementById("list")!;
  root.innerHTML = "";

  const shown = filteredItems();
  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      items.length === 0 ? t("historyEmpty") : t("historyNoMatch");
    root.appendChild(empty);
    return;
  }

  for (const item of shown) {
    const card = document.createElement("div");
    card.className = "item";
    card.dataset.id = item.id;

    const head = document.createElement("div");
    head.className = "item-head";

    const meta = document.createElement("div");
    meta.className = "item-meta";
    const time = document.createElement("span");
    time.textContent = formatTimestamp(item.createdAt);
    meta.appendChild(time);
    if (item.url) {
      const src = document.createElement("span");
      src.className = "source";
      src.textContent = item.pageTitle
        ? `${item.pageTitle} (${shortenUrl(item.url)})`
        : shortenUrl(item.url);
      src.title = item.url;
      meta.appendChild(src);
    }
    if (item.edited) {
      const badge = document.createElement("span");
      badge.className = "edited-badge";
      badge.textContent = t("historyEditedBadge");
      meta.appendChild(badge);
    }
    head.appendChild(meta);
    card.appendChild(head);

    if (editingId === item.id) {
      const wrap = document.createElement("div");
      wrap.className = "item-edit";
      const textarea = document.createElement("textarea");
      textarea.value = item.text;
      wrap.appendChild(textarea);

      const actions = document.createElement("div");
      actions.className = "item-actions";

      const save = document.createElement("button");
      save.textContent = t("historySaveButton");
      save.addEventListener("click", async () => {
        const newText = textarea.value;
        await updateHistoryItem(item.id, newText);
        item.text = newText;
        if (!item.originalText) item.originalText = item.originalText ?? item.text;
        item.edited = newText !== (item.originalText ?? newText);
        editingId = null;
        flash(t("historySavedFlash"));
        render();
      });
      actions.appendChild(save);

      const cancel = document.createElement("button");
      cancel.className = "secondary";
      cancel.textContent = t("historyCancelButton");
      cancel.addEventListener("click", () => {
        editingId = null;
        render();
      });
      actions.appendChild(cancel);

      if (item.edited && item.originalText != null) {
        const revert = document.createElement("button");
        revert.className = "secondary";
        revert.textContent = t("historyRevertButton");
        revert.addEventListener("click", async () => {
          const original = item.originalText!;
          await updateHistoryItem(item.id, original);
          item.text = original;
          item.edited = false;
          editingId = null;
          flash(t("historyRevertedFlash"));
          render();
        });
        actions.appendChild(revert);
      }
      wrap.appendChild(actions);
      card.appendChild(wrap);

      window.setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }, 0);
    } else {
      const textBox = document.createElement("div");
      textBox.className = "item-text";
      textBox.textContent = item.text;
      const isExpanded = expandedIds.has(item.id);
      if (isExpanded) textBox.classList.add("expanded");
      card.appendChild(textBox);

      window.setTimeout(() => {
        if (textBox.scrollHeight > textBox.clientHeight + 2) {
          textBox.classList.add("has-overflow");
        }
      }, 0);

      const actions = document.createElement("div");
      actions.className = "item-actions";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = t("historyCopyButton");
      copyBtn.addEventListener("click", () => void copyText(item.text));
      actions.appendChild(copyBtn);

      const editBtn = document.createElement("button");
      editBtn.className = "secondary";
      editBtn.textContent = t("historyEditButton");
      editBtn.addEventListener("click", () => {
        editingId = item.id;
        render();
      });
      actions.appendChild(editBtn);

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "secondary small";
      toggleBtn.textContent = isExpanded
        ? t("historyCollapseButton")
        : t("historyExpandButton");
      toggleBtn.addEventListener("click", () => {
        if (isExpanded) expandedIds.delete(item.id);
        else expandedIds.add(item.id);
        render();
      });
      actions.appendChild(toggleBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "danger";
      delBtn.textContent = t("historyDeleteButton");
      delBtn.addEventListener("click", async () => {
        if (!confirm(t("historyDeleteConfirm"))) return;
        await deleteHistoryItem(item.id);
        items = items.filter((i) => i.id !== item.id);
        flash(t("historyDeletedFlash"));
        render();
      });
      actions.appendChild(delBtn);
      card.appendChild(actions);
    }

    root.appendChild(card);
  }
}

async function init(): Promise<void> {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n!;
    el.textContent = t(key);
  });
  document
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-placeholder]")
    .forEach((el) => {
      const key = (el as HTMLElement).dataset.i18nPlaceholder!;
      el.placeholder = t(key);
    });
  document.title = t("historyPageTitle");

  items = await listHistory();

  const focusId = focusFromHash();
  if (focusId && items.some((i) => i.id === focusId)) {
    editingId = focusId;
  }

  render();

  const searchEl = document.getElementById("search") as HTMLInputElement;
  searchEl.addEventListener("input", () => {
    searchQuery = searchEl.value.trim();
    render();
  });

  document.getElementById("clear-all")!.addEventListener("click", async () => {
    if (items.length === 0) return;
    if (!confirm(t("historyClearAllConfirm"))) return;
    await clearHistory();
    items = [];
    flash(t("historyClearedFlash"));
    render();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.ocrHistory) return;
    items = (changes.ocrHistory.newValue as OcrHistoryItem[]) ?? [];
    render();
  });
}

void init();
