/**
 * User settings stored in chrome.storage.sync.
 */

export interface Settings {
  showResultAlert?: boolean;
  debugMode?: boolean;
  /** OCR履歴を保存するか (default: true) */
  historyEnabled?: boolean;
  /** 履歴の最大件数 (default: 100, max: 500) */
  historyMaxItems?: number;
}

export const DEBUG_LAST_CROP_KEY = "debugLastCrop";

export interface DebugLastCrop {
  dataUrl: string;
  width: number;
  height: number;
  timestamp: number;
}

const STORAGE_KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const obj = await chrome.storage.sync.get(STORAGE_KEY);
  return (obj?.[STORAGE_KEY] as Settings) ?? {};
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
}
