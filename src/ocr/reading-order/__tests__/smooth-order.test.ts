import { describe, it, expect } from "vitest";
import { smoothOrder } from "../smooth-order";
import { createElement, type Element } from "../../parser/ndl-parser";

function makeLine(attrs: Record<string, string>): Element {
  return createElement("LINE", {
    TYPE: "本文",
    CONF: "0.9",
    ...attrs,
  });
}

describe("smoothOrder", () => {
  it("does not crash on empty PAGE", () => {
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" });
    expect(() => smoothOrder(page)).not.toThrow();
  });

  it("does not crash on PAGE with single LINE", () => {
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [
      makeLine({ X: "10", Y: "10", WIDTH: "200", HEIGHT: "30", ORDER: "0" }),
    ]);
    expect(() => smoothOrder(page)).not.toThrow();
  });

  it("preserves all elements after smoothing", () => {
    const lines = [
      makeLine({ X: "10", Y: "10", WIDTH: "200", HEIGHT: "30", ORDER: "0" }),
      makeLine({ X: "10", Y: "50", WIDTH: "200", HEIGHT: "30", ORDER: "1" }),
      makeLine({ X: "10", Y: "90", WIDTH: "200", HEIGHT: "30", ORDER: "2" }),
    ];
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [...lines]);
    smoothOrder(page);
    // All lines should still be present
    const remaining = page.children.filter((c) => c.tag === "LINE");
    expect(remaining).toHaveLength(3);
  });

  it("handles TEXTBLOCKs with LINEs", () => {
    const tb1 = createElement("TEXTBLOCK", {}, [
      makeLine({ X: "10", Y: "10", WIDTH: "200", HEIGHT: "30", ORDER: "0" }),
      makeLine({ X: "10", Y: "50", WIDTH: "200", HEIGHT: "30", ORDER: "1" }),
    ]);
    const tb2 = createElement("TEXTBLOCK", {}, [
      makeLine({ X: "10", Y: "200", WIDTH: "200", HEIGHT: "30", ORDER: "2" }),
      makeLine({ X: "10", Y: "240", WIDTH: "200", HEIGHT: "30", ORDER: "3" }),
    ]);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [tb1, tb2]);
    expect(() => smoothOrder(page)).not.toThrow();
    expect(page.children).toHaveLength(2);
  });

  it("traverses into non-PAGE root to find PAGE children", () => {
    const page = createElement("PAGE", { WIDTH: "500", HEIGHT: "500" }, [
      makeLine({ X: "10", Y: "10", WIDTH: "100", HEIGHT: "20", ORDER: "0" }),
      makeLine({ X: "10", Y: "40", WIDTH: "100", HEIGHT: "20", ORDER: "1" }),
    ]);
    const root = createElement("DOCUMENT", {}, [page]);
    expect(() => smoothOrder(root)).not.toThrow();
  });
});
