/**
 * User settings stored in chrome.storage.sync.
 */

export interface Settings {
  showResultAlert?: boolean;
}

const STORAGE_KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const obj = await chrome.storage.sync.get(STORAGE_KEY);
  return (obj?.[STORAGE_KEY] as Settings) ?? {};
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
}
