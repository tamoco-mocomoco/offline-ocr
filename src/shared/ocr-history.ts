/**
 * OCR履歴の永続化。chrome.storage.local 上に `OcrHistoryItem[]` を保持する。
 *
 * content script・viewer・extension pages いずれからもアクセスできる
 * (chrome.storage.local は extension のオリジン共有のため、content からも
 * 拡張機能側のストレージを読み書きできる)。
 *
 * v0.7 では imageBlob を含めず、テキスト + メタ情報のみを保存する MVP。
 * 後段で OcrResult ストアを IndexedDB に分けて拡張する余地は残してある。
 */

const STORAGE_KEY = "ocrHistory";
const DEFAULT_MAX_ITEMS = 100;
const HARD_CAP = 500;

export interface OcrHistoryItem {
  id: string;
  text: string;
  /** 編集前のテキスト。edited が true のときだけ意味を持つ */
  originalText?: string;
  edited: boolean;
  url?: string;
  pageTitle?: string;
  /** ms unix timestamp */
  createdAt: number;
  /** ms unix timestamp — 編集や手動更新があったとき */
  updatedAt?: number;
}

function makeId(): string {
  // 24bit ランダム + 36bit timestamp = ~60bit、衝突しにくい
  const rand = Math.floor(Math.random() * 0xffffff).toString(36);
  const ts = Date.now().toString(36);
  return `${ts}-${rand}`;
}

async function readAll(): Promise<OcrHistoryItem[]> {
  const obj = await chrome.storage.local.get(STORAGE_KEY);
  const arr = obj?.[STORAGE_KEY];
  return Array.isArray(arr) ? (arr as OcrHistoryItem[]) : [];
}

async function writeAll(items: OcrHistoryItem[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: items });
}

export interface AddHistoryMeta {
  url?: string;
  pageTitle?: string;
  /** UI 側で最大件数を override したいとき */
  maxItems?: number;
}

/**
 * 履歴に追加して、追加された item を返す。
 * 既存の MAX_ITEMS を超えたら古いものから FIFO で消す。
 */
export async function addToHistory(
  text: string,
  meta: AddHistoryMeta = {},
): Promise<OcrHistoryItem> {
  const items = await readAll();
  const item: OcrHistoryItem = {
    id: makeId(),
    text,
    originalText: text,
    edited: false,
    url: meta.url,
    pageTitle: meta.pageTitle,
    createdAt: Date.now(),
  };
  // 新しいものを先頭に
  items.unshift(item);
  const limit = Math.min(meta.maxItems ?? DEFAULT_MAX_ITEMS, HARD_CAP);
  if (items.length > limit) items.length = limit;
  await writeAll(items);
  return item;
}

export async function listHistory(): Promise<OcrHistoryItem[]> {
  return readAll();
}

export async function getHistoryItem(id: string): Promise<OcrHistoryItem | null> {
  const items = await readAll();
  return items.find((i) => i.id === id) ?? null;
}

export async function updateHistoryItem(id: string, newText: string): Promise<void> {
  const items = await readAll();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  if (item.originalText == null) item.originalText = item.text;
  item.text = newText;
  item.edited = newText !== item.originalText;
  item.updatedAt = Date.now();
  await writeAll(items);
}

export async function deleteHistoryItem(id: string): Promise<void> {
  const items = await readAll();
  const next = items.filter((i) => i.id !== id);
  await writeAll(next);
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export { DEFAULT_MAX_ITEMS, HARD_CAP };
