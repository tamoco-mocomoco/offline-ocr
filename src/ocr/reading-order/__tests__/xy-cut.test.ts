import { describe, it, expect } from "vitest";
import { solveXyCut } from "../xy-cut";

describe("solveXyCut", () => {
  it("returns empty array for empty input", () => {
    expect(solveXyCut([])).toEqual([]);
  });

  it("returns [0] for single bbox", () => {
    const ranks = solveXyCut([[10, 10, 100, 50]]);
    expect(ranks).toEqual([0]);
  });

  it("orders horizontal lines top-to-bottom", () => {
    // Three horizontal lines stacked vertically
    const bboxes = [
      [10, 100, 200, 130], // middle
      [10, 10, 200, 40],   // top
      [10, 200, 200, 230], // bottom
    ];
    const ranks = solveXyCut(bboxes);
    // top should have lowest rank, bottom highest
    expect(ranks[1]).toBeLessThan(ranks[0]);
    expect(ranks[0]).toBeLessThan(ranks[2]);
  });

  it("orders vertical columns right-to-left (Japanese reading order)", () => {
    // Three tall vertical columns side by side
    const bboxes = [
      [100, 10, 130, 300], // middle column
      [200, 10, 230, 300], // right column (read first in Japanese)
      [10, 10, 40, 300],   // left column (read last)
    ];
    const ranks = solveXyCut(bboxes);
    // right column first, then middle, then left
    expect(ranks[1]).toBeLessThan(ranks[0]);
    expect(ranks[0]).toBeLessThan(ranks[2]);
  });

  it("assigns unique ranks to all bboxes", () => {
    const bboxes = [
      [10, 10, 100, 40],
      [10, 50, 100, 80],
      [10, 90, 100, 120],
      [10, 130, 100, 160],
    ];
    const ranks = solveXyCut(bboxes);
    const uniqueRanks = new Set(ranks);
    expect(uniqueRanks.size).toBe(bboxes.length);
  });

  it("handles two-column layout", () => {
    // Left column (2 lines) + Right column (2 lines)
    // Horizontal layout → left column first
    const bboxes = [
      [10, 10, 200, 40],   // left col, line 1
      [10, 50, 200, 80],   // left col, line 2
      [300, 10, 500, 40],  // right col, line 1
      [300, 50, 500, 80],  // right col, line 2
    ];
    const ranks = solveXyCut(bboxes);
    // Left column lines should come before right column lines
    expect(ranks[0]).toBeLessThan(ranks[2]);
    expect(ranks[1]).toBeLessThan(ranks[3]);
  });

  it("handles overlapping bboxes without crashing", () => {
    const bboxes = [
      [10, 10, 100, 50],
      [50, 20, 150, 60],
      [80, 30, 200, 70],
    ];
    const ranks = solveXyCut(bboxes);
    expect(ranks).toHaveLength(3);
    expect(new Set(ranks).size).toBe(3);
  });
});
