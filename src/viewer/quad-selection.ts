/**
 * "Four-corner selection" mode — pure logic for the viewer's quadrilateral
 * (trapezoid) region picker used to feed a perspective-corrected image into
 * the OCR pipeline.
 *
 * This module is intentionally free of Canvas / DOM globals so vitest can
 * verify constraint math without a browser. The viewer wires up drawing +
 * pointer events; everything reachable here is a plain function.
 */

import type { Point } from "../ocr/engine/perspective";

export type Corner = 0 | 1 | 2 | 3;

export interface QuadState {
  /** Corners in order: top-left, top-right, bottom-right, bottom-left. */
  corners: [Point, Point, Point, Point];
  /** Which corner is currently being dragged (-1 when idle). */
  draggingIndex: -1 | Corner;
}

/**
 * Initial 4-point layout: an inset rectangle at `marginRatio` from each edge.
 * Order: TL, TR, BR, BL.
 */
export function initQuad(
  w: number,
  h: number,
  marginRatio = 0.1,
): QuadState {
  const m = marginRatio;
  return {
    corners: [
      { x: w * m, y: h * m },
      { x: w * (1 - m), y: h * m },
      { x: w * (1 - m), y: h * (1 - m) },
      { x: w * m, y: h * (1 - m) },
    ],
    draggingIndex: -1,
  };
}

/**
 * Return the index of the corner closest to `p` if it's within `radiusPx`,
 * else -1. Uses squared distance to avoid sqrt.
 */
export function hitTestCorner(
  state: QuadState,
  p: Point,
  radiusPx: number,
): -1 | Corner {
  const r2 = radiusPx * radiusPx;
  let best: -1 | Corner = -1;
  let bestD = r2;
  for (let i = 0; i < 4; i++) {
    const dx = state.corners[i].x - p.x;
    const dy = state.corners[i].y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i as Corner;
    }
  }
  return best;
}

/**
 * Update a corner position, clamping to the image bounds and rejecting moves
 * that would make the quadrilateral non-convex (self-intersecting).
 *
 * The convexity check keeps the pipeline downstream sane: a self-intersecting
 * quad would map to a fold in the perspective warp, which is neither useful
 * nor visually recoverable.
 */
export function moveCorner(
  state: QuadState,
  idx: Corner,
  p: Point,
  imgW: number,
  imgH: number,
  minInsetPx = 2,
): QuadState {
  const clampedX = clamp(p.x, minInsetPx, imgW - minInsetPx);
  const clampedY = clamp(p.y, minInsetPx, imgH - minInsetPx);
  const next: [Point, Point, Point, Point] = [
    { ...state.corners[0] },
    { ...state.corners[1] },
    { ...state.corners[2] },
    { ...state.corners[3] },
  ];
  next[idx] = { x: clampedX, y: clampedY };
  if (!isConvexQuad(next)) {
    // Reject: return unchanged state (except draggingIndex may still be set).
    return state;
  }
  return { corners: next, draggingIndex: state.draggingIndex };
}

/**
 * A quadrilateral is convex iff every consecutive edge cross-product has the
 * same sign. Signed area avoids needing separate CW/CCW handling — we just
 * require the sign to be uniform across all 4 edges.
 */
export function isConvexQuad(pts: readonly Point[]): boolean {
  if (pts.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false; // collinear → degenerate
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * Choose the destination rectangle size for the perspective warp. Takes the
 * max of parallel edge lengths so no content is compressed.
 *
 * dstW = max(|TL→TR|, |BL→BR|)
 * dstH = max(|TL→BL|, |TR→BR|)
 */
export function suggestOutputSize(state: QuadState): {
  w: number;
  h: number;
} {
  const c = state.corners;
  const w = Math.max(dist(c[0], c[1]), dist(c[3], c[2]));
  const h = Math.max(dist(c[0], c[3]), dist(c[1], c[2]));
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/**
 * Destination quad matching `suggestOutputSize` — used as the `dst` argument
 * to `computeHomography`.
 */
export function outputCorners(w: number, h: number): [Point, Point, Point, Point] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
