/**
 * Regex-based cleaning rules applied to OCR text before it is written to the
 * clipboard. Rules are stored in `chrome.storage.sync` so they sync across
 * the user's Chrome profiles.
 */

export interface CleaningRule {
  id: string;
  name: string;
  comment?: string;
  pattern: string;
  flags: string;
  replacement: string;
  enabled: boolean;
}

export const STORAGE_KEY = "cleaningRules";

export async function loadRules(): Promise<CleaningRule[]> {
  const obj = await chrome.storage.sync.get(STORAGE_KEY);
  const rules = obj?.[STORAGE_KEY];
  return Array.isArray(rules) ? (rules as CleaningRule[]) : [];
}

export async function saveRules(rules: CleaningRule[]): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: rules });
}

/**
 * Interpret backslash escape sequences in a replacement string.
 *
 * String.prototype.replace recognizes `$1`/`$&` substitution patterns but does
 * NOT interpret `\n`/`\t`/`\\` etc. — those would be inserted verbatim. Users
 * who type `\t` in the replacement field expect a tab, so we pre-process the
 * string. Unknown escapes are left alone (the backslash is preserved) so the
 * behavior is conservative.
 */
export function unescapeReplacement(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const next = s[i + 1];
      switch (next) {
        case "n": out += "\n"; i++; continue;
        case "r": out += "\r"; i++; continue;
        case "t": out += "\t"; i++; continue;
        case "\\": out += "\\"; i++; continue;
        case "0": out += "\0"; i++; continue;
      }
    }
    out += s[i];
  }
  return out;
}

/**
 * Apply enabled rules sequentially. Bad regex patterns are skipped (not
 * thrown) so that one broken rule doesn't break the whole pipeline.
 */
export function applyCleaningRules(
  text: string,
  rules: CleaningRule[],
): string {
  let out = text;
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue;
    try {
      const re = new RegExp(rule.pattern, rule.flags || "");
      out = out.replace(re, unescapeReplacement(rule.replacement));
    } catch (e) {
      console.warn(
        `[ndlocr-lite] skipping invalid rule "${rule.name}":`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return out;
}
