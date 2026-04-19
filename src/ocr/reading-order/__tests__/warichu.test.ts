import { describe, it, expect } from "vitest";
import { withGroupedWarichu } from "../warichu";
import { createElement, findAll, type Element } from "../../parser/ndl-parser";

function makeWarichuLine(x: number, y: number, w: number, h: number): Element {
  return createElement("LINE", {
    TYPE: "割注",
    X: String(x),
    Y: String(y),
    WIDTH: String(w),
    HEIGHT: String(h),
    CONF: "0.8",
    ORDER: "0",
  });
}

function makeLine(x: number, y: number, w: number, h: number): Element {
  return createElement("LINE", {
    TYPE: "本文",
    X: String(x),
    Y: String(y),
    WIDTH: String(w),
    HEIGHT: String(h),
    CONF: "0.9",
    ORDER: "0",
  });
}

describe("withGroupedWarichu", () => {
  it("groups overlapping warichu LINEs into WARICHUBLOCK during callback", () => {
    const w1 = makeWarichuLine(100, 10, 50, 20);
    const w2 = makeWarichuLine(100, 25, 50, 20); // overlaps with w1 vertically (after dilation)
    const normalLine = makeLine(10, 10, 200, 30);
    const tb = createElement("TEXTBLOCK", {}, [normalLine, w1, w2]);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [tb]);

    let warichuBlocksInsideCallback: Element[] = [];
    withGroupedWarichu(page, () => {
      warichuBlocksInsideCallback = findAll(page, "WARICHUBLOCK");
    });

    // During callback, warichu should be grouped
    expect(warichuBlocksInsideCallback.length).toBeGreaterThanOrEqual(1);

    // After callback, warichu should be ungrouped (WAR ICHUBLOCKs removed)
    const warichuBlocksAfter = findAll(page, "WARICHUBLOCK");
    expect(warichuBlocksAfter).toHaveLength(0);
  });

  it("ungroups all WAR ICHUBLOCKs after callback completes", () => {
    const w1 = makeWarichuLine(100, 10, 50, 20);
    const tb = createElement("TEXTBLOCK", {}, [w1]);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [tb]);

    withGroupedWarichu(page, () => {});

    // All LINE elements should be back as direct children
    const lines = findAll(page, "LINE");
    expect(lines).toHaveLength(1);
    expect(lines[0].attrs.TYPE).toBe("割注");
  });

  it("preserves non-warichu LINEs untouched", () => {
    const normalLine = makeLine(10, 10, 200, 30);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [normalLine]);

    withGroupedWarichu(page, () => {});

    const lines = findAll(page, "LINE");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(normalLine);
  });

  it("handles page with no warichu lines", () => {
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [
      makeLine(10, 10, 200, 30),
      makeLine(10, 50, 200, 30),
    ]);
    expect(() => withGroupedWarichu(page, () => {})).not.toThrow();
    expect(findAll(page, "LINE")).toHaveLength(2);
  });

  it("handles non-overlapping warichu as separate groups", () => {
    // Two warichu lines far apart
    const w1 = makeWarichuLine(10, 10, 50, 20);
    const w2 = makeWarichuLine(500, 500, 50, 20);
    const tb = createElement("TEXTBLOCK", {}, [w1, w2]);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [tb]);

    let groupCount = 0;
    withGroupedWarichu(page, () => {
      groupCount = findAll(page, "WARICHUBLOCK").length;
    });

    expect(groupCount).toBe(2);
  });

  it("sets correct bounding box on WARICHUBLOCK", () => {
    const w1 = makeWarichuLine(100, 10, 50, 20);
    const w2 = makeWarichuLine(100, 25, 50, 20);
    const tb = createElement("TEXTBLOCK", {}, [w1, w2]);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [tb]);

    withGroupedWarichu(page, () => {
      const blocks = findAll(page, "WARICHUBLOCK");
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      const block = blocks[0];
      // Bounding box should encompass both warichu lines
      const bx = parseInt(block.attrs.X);
      const by = parseInt(block.attrs.Y);
      const bw = parseInt(block.attrs.WIDTH);
      const bh = parseInt(block.attrs.HEIGHT);
      expect(bx).toBeLessThanOrEqual(100);
      expect(by).toBeLessThanOrEqual(10);
      expect(bx + bw).toBeGreaterThanOrEqual(150);
      expect(by + bh).toBeGreaterThanOrEqual(45);
    });
  });
});
