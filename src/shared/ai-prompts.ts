/**
 * Offline AI prompt presets.
 *
 * 各プロンプトは「タイトル」+「内容」で構成され、{{text}} プレースホルダに
 * OCR結果（クリーニングルール適用後）が挿入される。{{text}} が無い場合は
 * 末尾に自動付加される想定。
 *
 * 一覧から1つだけをアクティブにして適用する（クリーニングルールのように
 * 順に適用するわけではない）。アクティブな ID は Settings.aiActivePromptId
 * に保存される。
 */

export interface AIPrompt {
  id: string;
  title: string;
  content: string;
}

export const AI_PROMPTS_STORAGE_KEY = "aiPrompts";

export const PROMPT_PLACEHOLDER = "{{text}}";

export async function loadAIPrompts(): Promise<AIPrompt[]> {
  const obj = await chrome.storage.sync.get(AI_PROMPTS_STORAGE_KEY);
  const prompts = obj?.[AI_PROMPTS_STORAGE_KEY];
  return Array.isArray(prompts) ? (prompts as AIPrompt[]) : [];
}

export async function saveAIPrompts(prompts: AIPrompt[]): Promise<void> {
  await chrome.storage.sync.set({ [AI_PROMPTS_STORAGE_KEY]: prompts });
}

/**
 * Render the prompt with the OCR text substituted. If the prompt does not
 * contain the {{text}} placeholder, the text is appended at the end (separated
 * by a blank line) so that any prompt is at least usable.
 */
export function renderPrompt(prompt: string, text: string): string {
  if (prompt.includes(PROMPT_PLACEHOLDER)) {
    return prompt.split(PROMPT_PLACEHOLDER).join(text);
  }
  return `${prompt}\n\n${text}`;
}
