/**
 * Tests for joinLinesWithRowDetection — the function that decides whether two
 * consecutive recognized OCR lines should be joined by TAB (same row of a
 * table) or NEWLINE.
 */

import { describe, it, expect } from "vitest";
import {
  joinLinesWithRowDetection as join,
  type RecognizedLine,
} from "../../shared/join-lines";

type Line = RecognizedLine;

describe("joinLinesWithRowDetection", () => {
  const h = (
    text: string,
    x: number,
    y: number,
    w = 100,
    height = 20,
  ): Line => ({ text, x, y, w, h: height });

  it("returns empty for no lines", () => {
    expect(join([])).toBe("");
  });

  it("returns single text for one line", () => {
    expect(join([h("hello", 0, 0)])).toBe("hello");
  });

  it("joins vertically-stacked lines with newline", () => {
    const out = join([h("first", 0, 0), h("second", 0, 30)]);
    expect(out).toBe("first\nsecond");
  });

  it("joins side-by-side lines on the same row with TAB", () => {
    // Three receipt cells on the same row at y≈10
    const out = join([
      h("77", 0, 10, 30, 20),
      h("大陸サーモン", 50, 10, 150, 20),
      h("¥10.40", 220, 10, 80, 20),
    ]);
    expect(out).toBe("77\t大陸サーモン\t¥10.40");
  });

  it("uses TAB within a row and NEWLINE between rows", () => {
    const out = join([
      // row 1
      h("a", 0, 0, 30, 20),
      h("b", 50, 0, 30, 20),
      // row 2
      h("c", 0, 30, 30, 20),
      h("d", 50, 30, 30, 20),
    ]);
    expect(out).toBe("a\tb\nc\td");
  });

  it("tolerates small vertical misalignment within a row", () => {
    // Two cells offset by 3px vertically but mostly overlapping
    const out = join([
      h("left", 0, 10, 80, 20),
      h("right", 100, 13, 80, 20),
    ]);
    expect(out).toBe("left\tright");
  });

  it("uses newline when vertical overlap is below 50%", () => {
    // 20px-tall lines offset by 12px → overlap is 8px which is < 10 (half)
    const out = join([h("up", 0, 0, 80, 20), h("down", 0, 12, 80, 20)]);
    expect(out).toBe("up\ndown");
  });

  it("uses newline for vertical text (h > w) even at similar y", () => {
    // Two vertical columns of Japanese text: tall and narrow
    const out = join([
      h("行1", 100, 0, 20, 200),
      h("行2", 70, 0, 20, 200),
    ]);
    expect(out).toBe("行1\n行2");
  });

  it("mixes vertical and horizontal lines safely", () => {
    const out = join([
      h("body line", 0, 0, 200, 20),
      h("縦", 0, 30, 20, 200),
      h("after", 0, 250, 200, 20),
    ]);
    expect(out).toBe("body line\n縦\nafter");
  });

  it("filters out empty-text lines", () => {
    const out = join([h("kept", 0, 0), h("", 0, 30), h("also kept", 0, 60)]);
    expect(out).toBe("kept\nalso kept");
  });

  it("models the receipt case (3 rows × 3 cells each)", () => {
    const rows: Line[] = [];
    const ys = [10, 40, 70];
    const cells = [
      ["77", "大陸サーモン", "¥156.00"],
      ["27", "メロンミルクキャンディー", "¥877.50"],
      ["39", "ラズベリーヨーグルト", "¥86.40"],
    ];
    for (let r = 0; r < 3; r++) {
      rows.push(h(cells[r][0], 0, ys[r], 30, 20));
      rows.push(h(cells[r][1], 50, ys[r], 200, 20));
      rows.push(h(cells[r][2], 280, ys[r], 80, 20));
    }
    expect(join(rows)).toBe(
      "77\t大陸サーモン\t¥156.00\n" +
      "27\tメロンミルクキャンディー\t¥877.50\n" +
      "39\tラズベリーヨーグルト\t¥86.40",
    );
  });
});
