import { describe, it, expect } from "vitest";
import {
  createElement,
  detectionsToPage,
  findAll,
  findParent,
  elementToXml,
  type Element,
} from "../ndl-parser";
import type { Detection } from "../../engine/deim";

// ── createElement ──

describe("createElement", () => {
  it("creates element with defaults", () => {
    const el = createElement("LINE");
    expect(el).toEqual({ tag: "LINE", attrs: {}, children: [] });
  });

  it("creates element with attrs and children", () => {
    const child = createElement("SHAPE");
    const el = createElement("TEXTBLOCK", { CONF: "0.9" }, [child]);
    expect(el.tag).toBe("TEXTBLOCK");
    expect(el.attrs.CONF).toBe("0.9");
    expect(el.children).toHaveLength(1);
    expect(el.children[0]).toBe(child);
  });
});

// ── findAll ──

describe("findAll", () => {
  it("finds elements recursively", () => {
    const line1 = createElement("LINE", { X: "10" });
    const line2 = createElement("LINE", { X: "20" });
    const tb = createElement("TEXTBLOCK", {}, [line1]);
    const page = createElement("PAGE", {}, [tb, line2]);
    const found = findAll(page, "LINE");
    expect(found).toHaveLength(2);
    expect(found).toContain(line1);
    expect(found).toContain(line2);
  });

  it("returns empty array when no match", () => {
    const page = createElement("PAGE");
    expect(findAll(page, "LINE")).toEqual([]);
  });

  it("includes root if tag matches", () => {
    const page = createElement("PAGE");
    expect(findAll(page, "PAGE")).toEqual([page]);
  });
});

// ── findParent ──

describe("findParent", () => {
  it("finds direct parent", () => {
    const line = createElement("LINE");
    const tb = createElement("TEXTBLOCK", {}, [line]);
    const page = createElement("PAGE", {}, [tb]);
    expect(findParent(page, line)).toBe(tb);
    expect(findParent(page, tb)).toBe(page);
  });

  it("returns null if not found", () => {
    const page = createElement("PAGE");
    const orphan = createElement("LINE");
    expect(findParent(page, orphan)).toBeNull();
  });
});

// ── elementToXml ──

describe("elementToXml", () => {
  it("serializes self-closing element", () => {
    const el = createElement("LINE", { X: "10", Y: "20" });
    expect(elementToXml(el)).toBe('<LINE X="10" Y="20"></LINE>');
  });

  it("serializes nested elements", () => {
    const child = createElement("LINE", { X: "0" });
    const parent = createElement("TEXTBLOCK", { CONF: "0.5" }, [child]);
    const xml = elementToXml(parent);
    expect(xml).toContain("<TEXTBLOCK");
    expect(xml).toContain('  <LINE X="0"></LINE>');
    expect(xml).toContain("</TEXTBLOCK>");
  });
});

// ── detectionsToPage ──

describe("detectionsToPage", () => {
  it("returns PAGE element with correct dimensions", () => {
    const page = detectionsToPage(1024, 800, "test.png", []);
    expect(page.tag).toBe("PAGE");
    expect(page.attrs.WIDTH).toBe("1024");
    expect(page.attrs.HEIGHT).toBe("800");
    expect(page.attrs.IMAGENAME).toBe("test.png");
  });

  it("places lines inside text blocks", () => {
    const detections: Detection[] = [
      // text_block (classIndex 0)
      { classIndex: 0, box: [100, 100, 500, 400], confidence: 0.9 },
      // line_main (classIndex 1) inside the text block
      { classIndex: 1, box: [120, 120, 480, 160], confidence: 0.8 },
      { classIndex: 1, box: [120, 170, 480, 210], confidence: 0.85 },
    ];
    const page = detectionsToPage(1024, 800, "test.png", detections);
    const textblocks = findAll(page, "TEXTBLOCK");
    expect(textblocks.length).toBeGreaterThanOrEqual(1);
    const lines = findAll(textblocks[0], "LINE");
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("filters low-confidence detections", () => {
    const detections: Detection[] = [
      { classIndex: 1, box: [10, 10, 100, 50], confidence: 0.05 },
    ];
    const page = detectionsToPage(1024, 800, "test.png", detections, 0.1);
    const lines = findAll(page, "LINE");
    expect(lines).toHaveLength(0);
  });

  it("creates independent lines for lines outside blocks", () => {
    const detections: Detection[] = [
      { classIndex: 1, box: [10, 10, 200, 50], confidence: 0.9 },
    ];
    const page = detectionsToPage(1024, 800, "test.png", detections);
    // Line should be a direct child of PAGE (no TEXTBLOCK parent)
    const lines = page.children.filter((c) => c.tag === "LINE");
    expect(lines).toHaveLength(1);
  });

  it("handles table blocks", () => {
    const detections: Detection[] = [
      // block_table (classIndex 15)
      { classIndex: 15, box: [50, 50, 500, 300], confidence: 0.9 },
      // line_main inside table
      { classIndex: 1, box: [60, 60, 200, 100], confidence: 0.8 },
    ];
    const page = detectionsToPage(1024, 800, "test.png", detections);
    const blocks = findAll(page, "BLOCK");
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0].attrs.TYPE).toBe("表組");
  });

  it("filters bboxes smaller than minBboxSize", () => {
    const detections: Detection[] = [
      // Tiny text_block
      { classIndex: 0, box: [10, 10, 12, 12], confidence: 0.9 },
      // line inside it
      { classIndex: 1, box: [10, 10, 12, 12], confidence: 0.9 },
    ];
    const page = detectionsToPage(1024, 800, "test.png", detections, 0.1, 5);
    const textblocks = findAll(page, "TEXTBLOCK");
    // Tiny textblock should be filtered out
    expect(textblocks).toHaveLength(0);
  });

  it("handles ad blocks", () => {
    const detections: Detection[] = [
      // block_ad (classIndex 7)
      { classIndex: 7, box: [600, 50, 900, 300], confidence: 0.8 },
      // line_ad (classIndex 3) inside the ad block
      { classIndex: 3, box: [620, 60, 880, 100], confidence: 0.7 },
    ];
    const page = detectionsToPage(1024, 800, "test.png", detections);
    const blocks = findAll(page, "BLOCK");
    const adBlock = blocks.find((b) => b.attrs.TYPE === "広告");
    expect(adBlock).toBeDefined();
  });
});
