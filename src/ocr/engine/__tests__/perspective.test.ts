import { describe, it, expect } from "vitest";

// Node lacks the DOM ImageData class. Shim it *before* importing the module
// under test so `new ImageData(...)` inside applyPerspective resolves.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === "undefined") {
  class ImageDataShim {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(
      arg1: number | Uint8ClampedArray,
      arg2: number,
      arg3?: number,
    ) {
      if (typeof arg1 === "number") {
        this.width = arg1;
        this.height = arg2;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = arg1;
        this.width = arg2;
        this.height = arg3 ?? arg1.length / 4 / arg2;
      }
    }
  }
  (globalThis as { ImageData: unknown }).ImageData = ImageDataShim;
}

import {
  computeHomography,
  applyPerspective,
  type Point,
} from "../perspective";

const IDENTITY_CORNERS: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("computeHomography", () => {
  it("returns the identity for src == dst", () => {
    const h = computeHomography(IDENTITY_CORNERS, IDENTITY_CORNERS);
    // h[0]..h[8] should be [1,0,0, 0,1,0, 0,0,1] up to numerical noise
    expect(h[0]).toBeCloseTo(1, 6);
    expect(h[1]).toBeCloseTo(0, 6);
    expect(h[2]).toBeCloseTo(0, 6);
    expect(h[3]).toBeCloseTo(0, 6);
    expect(h[4]).toBeCloseTo(1, 6);
    expect(h[5]).toBeCloseTo(0, 6);
    expect(h[6]).toBeCloseTo(0, 6);
    expect(h[7]).toBeCloseTo(0, 6);
    expect(h[8]).toBeCloseTo(1, 6);
  });

  it("computes a pure scale for a scaled destination", () => {
    const dst: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const h = computeHomography(IDENTITY_CORNERS, dst);
    expect(h[0]).toBeCloseTo(2, 6);
    expect(h[4]).toBeCloseTo(2, 6);
    // No translation
    expect(h[2]).toBeCloseTo(0, 6);
    expect(h[5]).toBeCloseTo(0, 6);
    // No projective term
    expect(h[6]).toBeCloseTo(0, 6);
    expect(h[7]).toBeCloseTo(0, 6);
  });

  it("computes a translation-only homography", () => {
    const dst: Point[] = [
      { x: 5, y: 3 },
      { x: 15, y: 3 },
      { x: 15, y: 13 },
      { x: 5, y: 13 },
    ];
    const h = computeHomography(IDENTITY_CORNERS, dst);
    expect(h[0]).toBeCloseTo(1, 6);
    expect(h[2]).toBeCloseTo(5, 6);
    expect(h[4]).toBeCloseTo(1, 6);
    expect(h[5]).toBeCloseTo(3, 6);
  });
});

/** Build a simple ImageData with a gradient we can spot-check after warping. */
function gradient(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = Math.round((x * 255) / (w - 1)); // R varies by x
      data[i + 1] = Math.round((y * 255) / (h - 1)); // G varies by y
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return new ImageData(data, w, h);
}

describe("applyPerspective", () => {
  it("returns an image of the requested size", () => {
    const src = gradient(20, 20);
    const h = computeHomography(IDENTITY_CORNERS, IDENTITY_CORNERS);
    const out = applyPerspective(src, h, 10, 10);
    expect(out.width).toBe(10);
    expect(out.height).toBe(10);
  });

  it("identity homography roughly preserves pixel values", () => {
    const src = gradient(20, 20);
    // Map full source to full destination of the same size
    const srcCorners: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const h = computeHomography(srcCorners, srcCorners);
    const out = applyPerspective(src, h, 20, 20);
    // Spot-check a few pixels — bilinear at exact grid points should match
    for (const [x, y] of [
      [5, 5],
      [10, 10],
      [15, 3],
    ] as const) {
      const i = (y * 20 + x) * 4;
      expect(out.data[i]).toBe(src.data[i]);
      expect(out.data[i + 1]).toBe(src.data[i + 1]);
      expect(out.data[i + 2]).toBe(src.data[i + 2]);
    }
  });

  it("cropping via homography extracts the requested source rectangle", () => {
    const src = gradient(40, 40);
    // src quad = right half of image (20..40, 0..40)
    // dst quad = 20×40 at the origin
    const srcCorners: Point[] = [
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 20, y: 40 },
    ];
    const dstCorners: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 40 },
      { x: 0, y: 40 },
    ];
    const h = computeHomography(srcCorners, dstCorners);
    const out = applyPerspective(src, h, 20, 40);
    // Top-left pixel of the crop should equal source pixel (20,0)
    const srcI = (0 * 40 + 20) * 4;
    const outI = 0;
    expect(out.data[outI]).toBe(src.data[srcI]);
    expect(out.data[outI + 1]).toBe(src.data[srcI + 1]);
  });

  it("out-of-bounds destination pixels are opaque black", () => {
    const src = gradient(10, 10);
    // Map a source quad so most of the destination samples outside the source
    const srcCorners: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const dstCorners: Point[] = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
    ];
    const h = computeHomography(srcCorners, dstCorners);
    const out = applyPerspective(src, h, 50, 50);
    // (0,0) of output maps well outside the source
    expect(out.data[0]).toBe(0);
    expect(out.data[1]).toBe(0);
    expect(out.data[2]).toBe(0);
    expect(out.data[3]).toBe(255);
  });
});
