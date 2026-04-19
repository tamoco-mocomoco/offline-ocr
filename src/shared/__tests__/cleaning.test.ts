import { describe, it, expect } from "vitest";
import { applyCleaningRules, type CleaningRule } from "../cleaning";

function rule(
  pattern: string,
  replacement: string,
  flags = "g",
  enabled = true,
): CleaningRule {
  return {
    id: crypto.randomUUID(),
    name: "test",
    pattern,
    flags,
    replacement,
    enabled,
  };
}

describe("applyCleaningRules", () => {
  it("applies a simple replacement", () => {
    const rules = [rule(",", "")];
    expect(applyCleaningRules("1,234,567", rules)).toBe("1234567");
  });

  it("applies multiple rules sequentially", () => {
    const rules = [
      rule("[,，]", ""),        // remove commas
      rule("\\s+", " "),        // collapse whitespace
    ];
    expect(applyCleaningRules("1,234，567  abc", rules)).toBe("1234567 abc");
  });

  it("skips disabled rules", () => {
    const rules = [rule(",", "", "g", false)];
    expect(applyCleaningRules("1,234", rules)).toBe("1,234");
  });

  it("skips rules with empty pattern", () => {
    const rules = [rule("", "X")];
    expect(applyCleaningRules("hello", rules)).toBe("hello");
  });

  it("skips invalid regex patterns gracefully", () => {
    const rules = [rule("[invalid", "X")];
    // Should not throw, just skip the rule
    expect(applyCleaningRules("hello", rules)).toBe("hello");
  });

  it("respects regex flags", () => {
    const rules = [rule("abc", "X", "gi")];
    expect(applyCleaningRules("ABC abc Abc", rules)).toBe("X X X");
  });

  it("removes spaces between Japanese characters", () => {
    const rules = [rule("([ぁ-んァ-ヶ一-龥])\\s+([ぁ-んァ-ヶ一-龥])", "$1$2")];
    expect(applyCleaningRules("売 上 高", rules)).toBe("売上 高");
    // Note: the rule only removes one space at a time without 'g' flag
  });

  it("removes spaces between Japanese chars with global flag", () => {
    const rules = [rule("([ぁ-んァ-ヶ一-龥])\\s+([ぁ-んァ-ヶ一-龥])", "$1$2", "g")];
    // With g flag, consecutive matches are handled (though adjacent captures overlap)
    const result = applyCleaningRules("売 上 高", rules);
    // After first pass: "売上 高" (second space still between 上 and 高)
    // The regex uses capturing groups so only one space is removed per match
    expect(result).toBe("売上 高");
  });

  it("collapses multiple newlines", () => {
    const rules = [rule("\\n{2,}", "\n", "g")];
    expect(applyCleaningRules("a\n\n\nb\n\nc", rules)).toBe("a\nb\nc");
  });

  it("returns original text when no rules provided", () => {
    expect(applyCleaningRules("hello", [])).toBe("hello");
  });

  it("handles full-width and half-width comma removal", () => {
    const rules = [rule("[,，]", "", "g")];
    expect(applyCleaningRules("1,234，567", rules)).toBe("1234567");
  });
});
