import { describe, it, expect } from "vitest";
import { evalPage } from "../eval";
import { createElement, findAll, type Element } from "../../parser/ndl-parser";

function makeLine(x: number, y: number, w: number, h: number): Element {
  return createElement("LINE", {
    TYPE: "本文",
    X: String(x),
    Y: String(y),
    WIDTH: String(w),
    HEIGHT: String(h),
    CONF: "0.9",
  });
}

describe("evalPage", () => {
  it("assigns ORDER attributes to all LINEs", () => {
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [
      makeLine(10, 10, 200, 30),
      makeLine(10, 50, 200, 30),
      makeLine(10, 90, 200, 30),
    ]);
    evalPage(page, false);
    const lines = findAll(page, "LINE");
    for (const line of lines) {
      expect(line.attrs.ORDER).toBeDefined();
      expect(isNaN(parseInt(line.attrs.ORDER))).toBe(false);
    }
  });

  it("assigns unique ORDER values", () => {
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [
      makeLine(10, 10, 200, 30),
      makeLine(10, 60, 200, 30),
      makeLine(10, 110, 200, 30),
    ]);
    evalPage(page, false);
    const lines = findAll(page, "LINE");
    const orders = lines.map((l) => parseInt(l.attrs.ORDER));
    expect(new Set(orders).size).toBe(3);
  });

  it("handles LINEs inside TEXTBLOCKs", () => {
    const tb = createElement("TEXTBLOCK", {}, [
      makeLine(10, 50, 200, 30),
      makeLine(10, 10, 200, 30),
    ]);
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" }, [tb]);
    evalPage(page, false);
    const lines = findAll(page, "LINE");
    for (const line of lines) {
      expect(line.attrs.ORDER).toBeDefined();
    }
  });

  it("handles empty page without errors", () => {
    const page = createElement("PAGE", { WIDTH: "1000", HEIGHT: "800" });
    expect(() => evalPage(page)).not.toThrow();
  });

  it("works on non-PAGE root containing PAGE", () => {
    const page = createElement("PAGE", { WIDTH: "500", HEIGHT: "500" }, [
      makeLine(10, 10, 100, 20),
      makeLine(10, 40, 100, 20),
    ]);
    const root = createElement("DOCUMENT", {}, [page]);
    evalPage(root, false);
    const lines = findAll(root, "LINE");
    for (const line of lines) {
      expect(line.attrs.ORDER).toBeDefined();
    }
  });
});
