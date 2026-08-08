import { describe, it, expect } from "vitest";
import {
  hwcToChw,
  normalizeImageNet,
  normalizeBgr,
  argmaxAxis2,
  trimCtcLoopTail,
} from "../tensor-utils";

describe("hwcToChw", () => {
  it("transposes a 2x2x3 tensor correctly", () => {
    // HWC: [R,G,B, R,G,B, R,G,B, R,G,B] for 2x2 image
    const hwc = new Float32Array([
      1, 2, 3,   // (0,0) R=1 G=2 B=3
      4, 5, 6,   // (0,1) R=4 G=5 B=6
      7, 8, 9,   // (1,0) R=7 G=8 B=9
      10, 11, 12, // (1,1) R=10 G=11 B=12
    ]);
    const chw = hwcToChw(hwc, 2, 2, 3);
    // CHW layout: channel 0 (R): 1,4,7,10; channel 1 (G): 2,5,8,11; channel 2 (B): 3,6,9,12
    expect(Array.from(chw)).toEqual([
      1, 4, 7, 10,   // R
      2, 5, 8, 11,   // G
      3, 6, 9, 12,   // B
    ]);
  });

  it("handles single pixel", () => {
    const hwc = new Float32Array([0.5, 0.6, 0.7]);
    const chw = hwcToChw(hwc, 1, 1, 3);
    expect(chw[0]).toBeCloseTo(0.5);
    expect(chw[1]).toBeCloseTo(0.6);
    expect(chw[2]).toBeCloseTo(0.7);
  });
});

describe("normalizeImageNet", () => {
  it("normalizes pixel values with ImageNet mean/std", () => {
    // Single black pixel (RGBA: 0,0,0,255)
    const data = new Uint8ClampedArray([0, 0, 0, 255]);
    const result = normalizeImageNet(data, 1, 1);
    // (0/255 - mean) / std
    const expected = [
      (0 / 255 - 0.485) / 0.229,
      (0 / 255 - 0.456) / 0.224,
      (0 / 255 - 0.406) / 0.225,
    ];
    expect(result[0]).toBeCloseTo(expected[0], 4);
    expect(result[1]).toBeCloseTo(expected[1], 4);
    expect(result[2]).toBeCloseTo(expected[2], 4);
  });

  it("normalizes white pixel correctly", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255]);
    const result = normalizeImageNet(data, 1, 1);
    const expected = [
      (1.0 - 0.485) / 0.229,
      (1.0 - 0.456) / 0.224,
      (1.0 - 0.406) / 0.225,
    ];
    expect(result[0]).toBeCloseTo(expected[0], 4);
    expect(result[1]).toBeCloseTo(expected[1], 4);
    expect(result[2]).toBeCloseTo(expected[2], 4);
  });

  it("outputs 3 channels (alpha dropped)", () => {
    // 2x1 image
    const data = new Uint8ClampedArray([
      128, 64, 32, 255,
      0, 128, 255, 255,
    ]);
    const result = normalizeImageNet(data, 1, 2);
    expect(result.length).toBe(6); // 2 pixels * 3 channels
  });
});

describe("normalizeBgr", () => {
  it("flips RGB to BGR and normalizes to [-1, 1]", () => {
    // Single pixel: R=255, G=128, B=0, A=255
    const data = new Uint8ClampedArray([255, 128, 0, 255]);
    const result = normalizeBgr(data, 1, 1);
    // BGR: B = 2*(0/255) - 1 = -1.0, G = 2*(128/255) - 1, R = 2*(255/255) - 1 = 1.0
    expect(result[0]).toBeCloseTo(-1.0, 4); // B (from pixel index 2 = 0)
    expect(result[1]).toBeCloseTo(2 * (128 / 255) - 1, 4); // G
    expect(result[2]).toBeCloseTo(1.0, 4); // R (from pixel index 0 = 255)
  });

  it("maps black to [-1, -1, -1]", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255]);
    const result = normalizeBgr(data, 1, 1);
    expect(result[0]).toBeCloseTo(-1.0);
    expect(result[1]).toBeCloseTo(-1.0);
    expect(result[2]).toBeCloseTo(-1.0);
  });

  it("maps white to [1, 1, 1]", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255]);
    const result = normalizeBgr(data, 1, 1);
    expect(result[0]).toBeCloseTo(1.0);
    expect(result[1]).toBeCloseTo(1.0);
    expect(result[2]).toBeCloseTo(1.0);
  });
});

describe("argmaxAxis2", () => {
  it("finds argmax for each sequence position", () => {
    // seqLen=3, vocabSize=4
    const data = new Float32Array([
      0.1, 0.9, 0.2, 0.3, // pos 0 → idx 1
      0.5, 0.1, 0.8, 0.2, // pos 1 → idx 2
      0.3, 0.2, 0.1, 0.7, // pos 2 → idx 3
    ]);
    const result = argmaxAxis2(data, 3, 4);
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });

  it("handles single position", () => {
    const data = new Float32Array([0.1, 0.5, 0.3]);
    const result = argmaxAxis2(data, 1, 3);
    expect(result[0]).toBe(1);
  });

  it("returns first index on tie", () => {
    const data = new Float32Array([0.5, 0.5, 0.5]);
    const result = argmaxAxis2(data, 1, 3);
    // First max encountered wins
    expect(result[0]).toBe(0);
  });

  it("handles negative values", () => {
    const data = new Float32Array([-10, -5, -20]);
    const result = argmaxAxis2(data, 1, 3);
    expect(result[0]).toBe(1); // -5 is the max
  });
});

describe("trimCtcLoopTail", () => {
  it("leaves normal short text alone", () => {
    expect(trimCtcLoopTail("こんにちは")).toBe("こんにちは");
    expect(trimCtcLoopTail("hello world")).toBe("hello world");
    expect(trimCtcLoopTail("")).toBe("");
  });

  it("leaves 2 repetitions alone (not a loop)", () => {
    expect(trimCtcLoopTail("the the end")).toBe("the the end");
    expect(trimCtcLoopTail("は は")).toBe("は は");
  });

  it("trims a CTC-loop tail while keeping the correct prefix", () => {
    const input =
      "tamoco-mocomoco the the the the the the the the the the th";
    expect(trimCtcLoopTail(input)).toBe("tamoco-mocomoco");
  });

  it("returns empty when the whole output is a loop", () => {
    const input =
      "the the the the the the the the the the the the the the th";
    expect(trimCtcLoopTail(input)).toBe("");
  });

  it("trims a loop of a longer token too", () => {
    const input = "abc def ghi ghi ghi ghi ghi";
    expect(trimCtcLoopTail(input)).toBe("abc def");
  });

  it("trims from the first run when multiple runs exist", () => {
    // First run "aa aa aa" begins at index 1 — cut everything from there
    const input = "start aa aa aa middle bb bb bb end";
    expect(trimCtcLoopTail(input)).toBe("start");
  });

  it("does not fire on non-loop text with repeated 2-char words", () => {
    // Two-time repetition is fine; three consecutive same tokens is the trigger
    expect(trimCtcLoopTail("ha ha ok")).toBe("ha ha ok");
  });

  it("trims character-level repetition without whitespace", () => {
    // Real observed PARSeq output when it fails to decode a dark chip
    const input =
      "CHANGELOG_ja. CHANGE CHAND CON S.ES.ES.ES.ES.ES.IRES AHEDESHED";
    // The '.ES' pattern repeats 5+ times starting at position 33 (after
    // "CHANGELOG_ja. CHANGE CHAND CON S"). Everything from that S is cut.
    const out = trimCtcLoopTail(input);
    expect(out.startsWith("CHANGELOG_ja.")).toBe(true);
    expect(out).not.toContain(".ES.ES.ES");
    // Whatever's kept must not itself contain 3-run character repetition
    expect(out.length).toBeLessThan(input.length);
  });

  it("trims character-level repetition of long substrings too", () => {
    // Substring of length 4 repeating 3 times
    const input = "prefix xxABCDABCDABCD suffix";
    // 'ABCD' at pos 9,13,17 → 3-run → trim from pos 9 → "prefix xx"
    expect(trimCtcLoopTail(input)).toBe("prefix xx");
  });

  it("does not fire on legitimate short doubles", () => {
    // 2-char runs are not enough
    expect(trimCtcLoopTail("あいういう")).toBe("あいういう");
    expect(trimCtcLoopTail("hihi")).toBe("hihi");
  });

  it("word-level trim wins when it starts earlier than char-level", () => {
    // "aa aa aa" starts at pos 6 (word-level); no char-level 3-run earlier
    expect(trimCtcLoopTail("start aa aa aa xyzxyzxyz end")).toBe("start");
  });

  it("char-level trim wins when it starts earlier than word-level", () => {
    // "abcabcabc" 3-run at pos 6, word-level "zz zz zz" starts at pos 20
    expect(trimCtcLoopTail("start abcabcabc mid zz zz zz end")).toBe("start");
  });
});
