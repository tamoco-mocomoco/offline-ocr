/**
 * Guard against drift between the canonical applyCleaningRules in
 * src/shared/cleaning.ts and the inline copy duplicated in src/content/content.ts.
 *
 * Content scripts cannot import ES modules, so we keep an inline copy of the
 * regex-cleaning logic. Tests below extract that inline copy from the source
 * file via regex, eval it in isolation, and compare its behavior to the shared
 * implementation across a battery of inputs — including the backslash-escape
 * cases that previously regressed (replacement string "\t" rendering as the
 * literal two characters "\t" instead of a tab).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyCleaningRules as sharedApply,
  unescapeReplacement as sharedUnescape,
  type CleaningRule,
} from "../../shared/cleaning";

type ApplyFn = (text: string, rules: CleaningRule[]) => string;
type UnescapeFn = (s: string) => string;

function extract(source: string, fnName: string): string {
  // Match `function NAME(...): ... { ... }` allowing nested braces by greedy
  // balance using a simple stack.
  const start = source.indexOf(`function ${fnName}(`);
  if (start === -1) throw new Error(`function ${fnName} not found in content.ts`);
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
    if (depth < 0 || (bodyStart === -1 && i - start > 4000)) break;
  }
  throw new Error(`could not extract ${fnName}`);
}

describe("content.ts inline cleaning helpers stay in sync with shared/cleaning.ts", () => {
  let inlineApply: ApplyFn;
  let inlineUnescape: UnescapeFn;

  beforeAll(() => {
    const path = resolve(__dirname, "../content.ts");
    const source = readFileSync(path, "utf8");
    const unescapeSrc = extract(source, "unescapeReplacement");
    const applySrc = extract(source, "applyCleaningRules");
    // Strip TypeScript annotations that would choke a raw eval.
    const stripTs = (s: string) =>
      s
        .replace(/: CleaningRule\[\]/g, "")
        .replace(/: CleaningRule/g, "")
        .replace(/: string/g, "")
        .replace(/: number/g, "")
        .replace(/: boolean/g, "");
    // Construct an evaluatable bundle. Both functions are independent.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      `${stripTs(unescapeSrc)}\n${stripTs(applySrc)}\nreturn { applyCleaningRules, unescapeReplacement };`,
    );
    const exports = factory() as {
      applyCleaningRules: ApplyFn;
      unescapeReplacement: UnescapeFn;
    };
    inlineApply = exports.applyCleaningRules;
    inlineUnescape = exports.unescapeReplacement;
  });

  const rule = (
    pattern: string,
    replacement: string,
    flags = "g",
    enabled = true,
  ): CleaningRule => ({
    id: "x",
    name: "t",
    pattern,
    flags,
    replacement,
    enabled,
  });

  const cases: Array<[string, string, CleaningRule[]]> = [
    ["tab via \\t", "a,b,c", [rule(",", "\\t")]],
    ["newline via \\n", "a;b;c", [rule(";", "\\n")]],
    ["carriage return via \\r", "ab", [rule("b", "\\r")]],
    ["double backslash → single", "ab", [rule("b", "\\\\")]],
    ["unknown escape preserved", "ab", [rule("b", "\\q")]],
    ["mixed \\t and $1", "key=value", [rule("(\\w+)=(\\w+)", "$1\\t$2")]],
    ["plain replacement", "1,234", [rule(",", "")]],
    ["invalid regex skipped", "hello", [rule("[invalid", "X")]],
    ["multi-rule pipeline", "a 1,2,3 b", [rule(",", "\\t"), rule("\\s+", "_")]],
  ];

  for (const [label, input, rules] of cases) {
    it(`inline matches shared: ${label}`, () => {
      const inline = inlineApply(input, rules);
      const shared = sharedApply(input, rules);
      expect(inline).toBe(shared);
    });
  }

  it("inline unescapeReplacement matches shared on all escapes", () => {
    const inputs = ["\\t", "\\n", "\\r", "\\\\", "\\0", "\\q", "$1", "plain", "a\\tb\\nc"];
    for (const s of inputs) {
      expect(inlineUnescape(s)).toBe(sharedUnescape(s));
    }
  });

  it("\\t in replacement actually produces a tab character", () => {
    // This is the exact UI bug we are guarding against: user types `\t` and
    // expects a real tab, not the two characters backslash+t.
    const out = inlineApply("a,b,c", [rule(",", "\\t")]);
    expect(out).toBe("a\tb\tc");
    expect(out).not.toBe("a\\tb\\tc");
  });
});
