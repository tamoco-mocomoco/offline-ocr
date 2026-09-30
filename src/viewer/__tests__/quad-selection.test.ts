import { describe, it, expect } from "vitest";
import {
  initQuad,
  hitTestCorner,
  moveCorner,
  isConvexQuad,
  suggestOutputSize,
  outputCorners,
} from "../quad-selection";
import type { Point } from "../../ocr/engine/perspective";

describe("initQuad", () => {
  it("returns a 4-point inset rectangle at the given margin ratio", () => {
    const q = initQuad(1000, 500, 0.1);
    expect(q.corners).toEqual([
      { x: 100, y: 50 },
      { x: 900, y: 50 },
      { x: 900, y: 450 },
      { x: 100, y: 450 },
    ]);
    expect(q.draggingIndex).toBe(-1);
  });

  it("defaults marginRatio to 0.1", () => {
    const q = initQuad(200, 100);
    expect(q.corners[0]).toEqual({ x: 20, y: 10 });
  });

  it("initial quad is convex", () => {
    const q = initQuad(640, 480);
    expect(isConvexQuad(q.corners)).toBe(true);
  });
});

describe("hitTestCorner", () => {
  const q = initQuad(1000, 500, 0.1);
  // corners: TL(100,50) TR(900,50) BR(900,450) BL(100,450)

  it("hits the nearest corner when inside the radius", () => {
    expect(hitTestCorner(q, { x: 105, y: 52 }, 20)).toBe(0);
    expect(hitTestCorner(q, { x: 895, y: 50 }, 20)).toBe(1);
    expect(hitTestCorner(q, { x: 905, y: 445 }, 20)).toBe(2);
    expect(hitTestCorner(q, { x: 100, y: 455 }, 20)).toBe(3);
  });

  it("returns -1 outside the radius", () => {
    expect(hitTestCorner(q, { x: 500, y: 250 }, 20)).toBe(-1);
    expect(hitTestCorner(q, { x: 130, y: 50 }, 20)).toBe(-1);
  });

  it("picks the closest of two nearby corners", () => {
    // both TR (900,50) and BR (900,450) exist but TR is closer to (895, 80)
    expect(hitTestCorner(q, { x: 895, y: 80 }, 100)).toBe(1);
  });
});

describe("moveCorner", () => {
  const q = initQuad(1000, 500, 0.1);

  it("moves a corner within bounds", () => {
    const next = moveCorner(q, 0, { x: 200, y: 100 }, 1000, 500);
    expect(next.corners[0]).toEqual({ x: 200, y: 100 });
    // other corners unchanged
    expect(next.corners[1]).toEqual(q.corners[1]);
  });

  it("clamps to image bounds", () => {
    const next = moveCorner(q, 0, { x: -50, y: -50 }, 1000, 500, 2);
    expect(next.corners[0]).toEqual({ x: 2, y: 2 });
  });

  it("clamps to the far edge as well", () => {
    const next = moveCorner(q, 0, { x: 5000, y: 5000 }, 1000, 500, 2);
    // clamped to (998, 498), but that would make the quad self-intersect
    // with TR at (900, 50) so we expect rejection
    expect(next).toBe(q); // reference equality: rejected
  });

  it("rejects a move that would make the quad non-convex", () => {
    // Moving TL far past TR would flip the top edge
    const bad = moveCorner(q, 0, { x: 950, y: 50 }, 1000, 500);
    expect(bad).toBe(q);
  });

  it("accepts small adjustments that keep the quad convex", () => {
    const good = moveCorner(q, 0, { x: 150, y: 60 }, 1000, 500);
    expect(good).not.toBe(q);
    expect(isConvexQuad(good.corners)).toBe(true);
  });
});

describe("isConvexQuad", () => {
  it("returns true for a square", () => {
    expect(
      isConvexQuad([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBe(true);
  });

  it("returns true for a convex trapezoid", () => {
    expect(
      isConvexQuad([
        { x: 2, y: 0 },
        { x: 8, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBe(true);
  });

  it("returns false for a self-intersecting bowtie", () => {
    expect(
      isConvexQuad([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe(false);
  });

  it("returns false when 3 points are collinear", () => {
    expect(
      isConvexQuad([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ]),
    ).toBe(false);
  });

  it("returns false for wrong number of points", () => {
    expect(isConvexQuad([{ x: 0, y: 0 }])).toBe(false);
  });
});

describe("suggestOutputSize", () => {
  it("returns the max of parallel edge lengths", () => {
    const q = initQuad(1000, 500, 0.1);
    // TL(100,50) TR(900,50) BR(900,450) BL(100,450)
    // width  = max(|TL->TR|, |BL->BR|) = 800
    // height = max(|TL->BL|, |TR->BR|) = 400
    expect(suggestOutputSize(q)).toEqual({ w: 800, h: 400 });
  });

  it("handles slanted quads by taking the longer edge", () => {
    const q = initQuad(1000, 500, 0.1);
    // Widen the top edge only
    const skewed = moveCorner(q, 0, { x: 50, y: 60 }, 1000, 500);
    const s = suggestOutputSize(skewed);
    expect(s.w).toBeGreaterThanOrEqual(800);
    expect(s.h).toBeGreaterThan(0);
  });

  it("clamps degenerate quads to at least 1×1", () => {
    const q: ReturnType<typeof initQuad> = {
      corners: [
        { x: 0, y: 0 },
        { x: 0.4, y: 0 },
        { x: 0.4, y: 0.4 },
        { x: 0, y: 0.4 },
      ],
      draggingIndex: -1,
    };
    const s = suggestOutputSize(q);
    expect(s.w).toBeGreaterThanOrEqual(1);
    expect(s.h).toBeGreaterThanOrEqual(1);
  });
});

describe("outputCorners", () => {
  it("returns a rectangle at the origin with the given size", () => {
    const c = outputCorners(800, 400);
    expect(c).toEqual<Point[]>([
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 400 },
      { x: 0, y: 400 },
    ]);
  });
});
