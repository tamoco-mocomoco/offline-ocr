import { describe, it, expect } from "vitest";
import { sortLines } from "../reorder";
import { createElement, findAll, type Element } from "../../parser/ndl-parser";

function makeLine(attrs: Record<string, string>): Element {
  return createElement("LINE", {
    TYPE: "本文",
    CONF: "0.9",
    ...attrs,
  });
}

describe("sortLines", () => {
  it("sorts horizontal lines top-to-bottom within a TEXTBLOCK", () => {
    const line1 = makeLine({ X: "10", Y: "100", WIDTH: "200", HEIGHT: "30", ORDER: "1" });
    const line2 = makeLine({ X: "10", Y: "10", WIDTH: "200", HEIGHT: "30", ORDER: "0" });
    const line3 = makeLine({ X: "10", Y: "200", WIDTH: "200", HEIGHT: "30", ORDER: "2" });
    const tb = createElement("TEXTBLOCK", {}, [line1, line2, line3]);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [tb]);

    sortLines(page, false);

    const lines = findAll(tb, "LINE");
    const ys = lines.map((l) => parseInt(l.attrs.Y));
    // Should be sorted ascending by Y
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]);
    }
  });

  it("sorts vertical lines right-to-left within a TEXTBLOCK", () => {
    // Vertical lines (HEIGHT > WIDTH)
    const line1 = makeLine({ X: "100", Y: "10", WIDTH: "30", HEIGHT: "200", ORDER: "1" });
    const line2 = makeLine({ X: "200", Y: "10", WIDTH: "30", HEIGHT: "200", ORDER: "0" });
    const line3 = makeLine({ X: "10", Y: "10", WIDTH: "30", HEIGHT: "200", ORDER: "2" });
    const tb = createElement("TEXTBLOCK", {}, [line1, line2, line3]);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [tb]);

    sortLines(page, false);

    const lines = findAll(tb, "LINE");
    const xs = lines.map((l) => parseInt(l.attrs.X));
    // Vertical text: should be sorted descending by X (right-to-left)
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeLessThanOrEqual(xs[i - 1]);
    }
  });

  it("removes duplicate overlapping lines", () => {
    // Two lines with high overlap; lower confidence should be removed
    const line1 = makeLine({ X: "10", Y: "10", WIDTH: "200", HEIGHT: "30", CONF: "0.9", ORDER: "0" });
    const line2 = makeLine({ X: "12", Y: "11", WIDTH: "198", HEIGHT: "29", CONF: "0.5", ORDER: "1" });
    const line3 = makeLine({ X: "10", Y: "100", WIDTH: "200", HEIGHT: "30", CONF: "0.8", ORDER: "2" });
    const tb = createElement("TEXTBLOCK", {}, [line1, line2, line3]);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [tb]);

    sortLines(page, false);

    const lines = findAll(tb, "LINE");
    // line2 should be removed as a duplicate of line1
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("sorts TEXTBLOCKs by median ORDER at page level", () => {
    const tb1 = createElement("TEXTBLOCK", {}, [
      makeLine({ X: "10", Y: "200", WIDTH: "200", HEIGHT: "30", ORDER: "2" }),
    ]);
    const tb2 = createElement("TEXTBLOCK", {}, [
      makeLine({ X: "10", Y: "10", WIDTH: "200", HEIGHT: "30", ORDER: "0" }),
    ]);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [tb1, tb2]);

    sortLines(page, false);

    // tb2 (ORDER=0) should come before tb1 (ORDER=2)
    expect(page.children[0]).toBe(tb2);
    expect(page.children[1]).toBe(tb1);
  });

  it("handles empty page without errors", () => {
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" });
    expect(() => sortLines(page, false)).not.toThrow();
  });
});
