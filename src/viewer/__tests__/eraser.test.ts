import { describe, it, expect } from "vitest";
import {
  EraseLog,
  dominantColor,
  eraserRadius,
  paintStroke,
  samplingRect,
  ERASER_SCREEN_RADIUS,
  type EraseStroke,
} from "../eraser";

function pixels(colors: Array<[number, number, number, number?]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b, a = 255], i) => data.set([r, g, b, a], i * 4));
  return data;
}

function repeat<T>(n: number, v: T): T[] {
  return Array.from({ length: n }, () => v);
}

const stroke = (points: Array<[number, number]>, radius = 5): EraseStroke => ({
  points: points.map(([x, y]) => ({ x, y })),
  radius,
  color: { r: 10, g: 20, b: 30 },
});

describe("eraserRadius", () => {
  it("keeps the on-screen size by scaling with the display scale", () => {
    expect(eraserRadius("m", 1)).toBe(ERASER_SCREEN_RADIUS.m);
    expect(eraserRadius("m", 2.5)).toBe(ERASER_SCREEN_RADIUS.m * 2.5);
  });

  it("orders the sizes small < medium < large", () => {
    expect(eraserRadius("s", 1)).toBeLessThan(eraserRadius("m", 1));
    expect(eraserRadius("m", 1)).toBeLessThan(eraserRadius("l", 1));
  });

  it("never returns less than one pixel", () => {
    expect(eraserRadius("s", 0.01)).toBe(1);
  });
});

describe("samplingRect", () => {
  it("is a square of at least 64px centered on the point", () => {
    expect(samplingRect({ x: 500, y: 500 }, 4, 1000, 1000)).toEqual({
      x: 468,
      y: 468,
      w: 64,
      h: 64,
    });
  });

  it("grows with the brush radius", () => {
    const r = samplingRect({ x: 500, y: 500 }, 40, 1000, 1000);
    expect(r.w).toBe(320);
    expect(r.h).toBe(320);
  });

  it("is clamped to the image", () => {
    expect(samplingRect({ x: 5, y: 995 }, 4, 1000, 1000)).toEqual({
      x: 0,
      y: 963,
      w: 37,
      h: 37,
    });
  });
});

describe("dominantColor", () => {
  it("picks the background, not the ink, when ink is the minority", () => {
    const data = pixels([
      ...repeat(70, [255, 255, 255] as [number, number, number]),
      ...repeat(30, [0, 0, 0] as [number, number, number]),
    ]);
    expect(dominantColor(data)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("returns the exact background color (bucket mean, not bucket center)", () => {
    // A dark page: #0d1117 background with light text.
    const data = pixels([
      ...repeat(60, [13, 17, 23] as [number, number, number]),
      ...repeat(40, [230, 237, 243] as [number, number, number]),
    ]);
    expect(dominantColor(data)).toEqual({ r: 13, g: 17, b: 23 });
  });

  it("groups slightly noisy background pixels (JPEG noise) into one vote", () => {
    // 3 shades of near-white (one bucket) vs 4 black pixels.
    const data = pixels([
      [250, 250, 250],
      [252, 252, 252],
      [254, 254, 254],
      ...repeat(2, [0, 0, 0] as [number, number, number]),
    ]);
    expect(dominantColor(data)).toEqual({ r: 252, g: 252, b: 252 });
  });

  it("ignores fully transparent pixels", () => {
    const data = pixels([
      ...repeat(10, [0, 0, 0, 0] as [number, number, number, number]),
      [200, 100, 50],
    ]);
    expect(dominantColor(data)).toEqual({ r: 200, g: 100, b: 50 });
  });

  it("falls back to white when nothing is opaque", () => {
    expect(dominantColor(pixels([[0, 0, 0, 0]]))).toEqual({
      r: 255,
      g: 255,
      b: 255,
    });
  });
});

/** Minimal 2D context that records the drawing calls paintStroke makes. */
function recordingContext() {
  const calls: string[] = [];
  const ctx = {
    fillStyle: "" as string,
    strokeStyle: "" as string,
    lineWidth: 0,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    beginPath: () => calls.push("beginPath"),
    moveTo: (x: number, y: number) => calls.push(`moveTo ${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo ${x},${y}`),
    arc: (x: number, y: number, r: number) => calls.push(`arc ${x},${y} r=${r}`),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
  };
  return { ctx, calls };
}

describe("paintStroke", () => {
  it("paints a single click as a dot of the brush radius", () => {
    const { ctx, calls } = recordingContext();
    paintStroke(ctx, stroke([[10, 20]], 7));
    expect(calls).toEqual(["save", "beginPath", "arc 10,20 r=7", "fill", "restore"]);
    expect(ctx.fillStyle).toBe("rgb(10, 20, 30)");
  });

  it("paints a drag as a dot plus a round-capped line twice the radius wide", () => {
    const { ctx, calls } = recordingContext();
    paintStroke(ctx, stroke([[0, 0], [10, 0], [10, 10]], 4));
    expect(calls).toEqual([
      "save",
      "beginPath",
      "arc 0,0 r=4",
      "fill",
      "beginPath",
      "moveTo 0,0",
      "lineTo 10,0",
      "lineTo 10,10",
      "stroke",
      "restore",
    ]);
    expect(ctx.lineWidth).toBe(8);
    expect(ctx.lineCap).toBe("round");
    expect(ctx.lineJoin).toBe("round");
  });

  it("with fromIndex only paints the new segment", () => {
    const { ctx, calls } = recordingContext();
    paintStroke(ctx, stroke([[0, 0], [10, 0], [10, 10]]), 2);
    expect(calls).toEqual([
      "save",
      "beginPath",
      "moveTo 10,0",
      "lineTo 10,10",
      "stroke",
      "restore",
    ]);
  });

  it("does nothing for an empty stroke", () => {
    const { ctx, calls } = recordingContext();
    paintStroke(ctx, stroke([]));
    expect(calls).toEqual([]);
  });
});

describe("EraseLog", () => {
  it("keeps strokes per page", () => {
    const log = new EraseLog();
    const a = stroke([[1, 1]]);
    const b = stroke([[2, 2]]);
    log.push(1, a);
    log.push(2, b);
    expect(log.strokes(1)).toEqual([a]);
    expect(log.strokes(2)).toEqual([b]);
    expect(log.count(3)).toBe(0);
    expect(log.strokes(3)).toEqual([]);
  });

  it("undo removes the most recent stroke on that page only", () => {
    const log = new EraseLog();
    const a = stroke([[1, 1]]);
    const b = stroke([[2, 2]]);
    const other = stroke([[3, 3]]);
    log.push(0, a);
    log.push(0, b);
    log.push(1, other);
    expect(log.undo(0)).toBe(b);
    expect(log.strokes(0)).toEqual([a]);
    expect(log.count(1)).toBe(1);
  });

  it("undo on an empty page returns undefined", () => {
    expect(new EraseLog().undo(0)).toBeUndefined();
  });

  it("clearPage and clearAll", () => {
    const log = new EraseLog();
    log.push(1, stroke([[1, 1]]));
    log.push(2, stroke([[2, 2]]));
    log.clearPage(1);
    expect(log.count(1)).toBe(0);
    expect(log.count(2)).toBe(1);
    log.clearAll();
    expect(log.count(2)).toBe(0);
  });
});
