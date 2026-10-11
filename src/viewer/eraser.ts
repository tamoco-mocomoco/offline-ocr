/**
 * Eraser for the viewer: paint over parts of the image that shouldn't be
 * OCR'd (stamps, handwritten notes, figures, page numbers, …) before running
 * OCR.
 *
 * Strokes are filled with the *local* background color rather than white, so
 * erasing on a dark background or a colored page doesn't leave a bright blob
 * whose edges DEIM would pick up as text (the same reasoning as the
 * adjacent-color padding).
 *
 * Edits are kept as a stroke list (not pixel snapshots) so undo is just
 * "redraw the original image and replay the remaining strokes" — cheap even on
 * multi-megapixel images.
 */

import type { Point } from "../ocr/engine/perspective";

export type Rgb = { r: number; g: number; b: number };

export type EraseStroke = {
  points: Point[];
  /** Brush radius in image pixels. */
  radius: number;
  /** Fill color, sampled once when the stroke starts. */
  color: Rgb;
};

export type EraserSize = "s" | "m" | "l";

/** On-screen brush radius (CSS px) for each size. */
export const ERASER_SCREEN_RADIUS: Record<EraserSize, number> = {
  s: 6,
  m: 14,
  l: 28,
};

/**
 * Brush radius in image pixels, so the brush keeps the same on-screen size
 * whether the image is shown at 100% or scaled down to fit the window.
 */
export function eraserRadius(size: EraserSize, displayScale: number): number {
  return Math.max(1, ERASER_SCREEN_RADIUS[size] * displayScale);
}

/**
 * Square region (clamped to the image) sampled to choose a stroke's fill
 * color: a few brush widths around the starting point, so there is enough
 * background around the ink for the background to win the vote.
 */
export function samplingRect(
  p: Point,
  radius: number,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const half = Math.max(32, radius * 4);
  const x0 = Math.max(0, Math.floor(p.x - half));
  const y0 = Math.max(0, Math.floor(p.y - half));
  const x1 = Math.min(width, Math.ceil(p.x + half));
  const y1 = Math.min(height, Math.ceil(p.y + half));
  return {
    x: x0,
    y: y0,
    w: Math.max(1, x1 - x0),
    h: Math.max(1, y1 - y0),
  };
}

/**
 * Most common color in RGBA pixel data — the local background, since ink is
 * normally the minority. Votes in 16-level-per-channel buckets (so JPEG noise
 * doesn't split the background into many colors), then returns the mean of
 * the winning bucket so a pure white page is filled with exactly white.
 * Fully transparent pixels don't vote.
 */
export function dominantColor(data: Uint8ClampedArray): Rgb {
  const counts = new Uint32Array(4096);
  const sums = new Float64Array(4096 * 3);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    counts[k]++;
    sums[k * 3] += r;
    sums[k * 3 + 1] += g;
    sums[k * 3 + 2] += b;
  }
  let best = -1;
  let bestCount = 0;
  for (let k = 0; k < counts.length; k++) {
    if (counts[k] > bestCount) {
      bestCount = counts[k];
      best = k;
    }
  }
  if (best === -1) return { r: 255, g: 255, b: 255 };
  return {
    r: Math.round(sums[best * 3] / bestCount),
    g: Math.round(sums[best * 3 + 1] / bestCount),
    b: Math.round(sums[best * 3 + 2] / bestCount),
  };
}

type PaintContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "fill"
  | "stroke"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
>;

/**
 * Paint a stroke. With `fromIndex` > 0 only the segment(s) ending at
 * points[fromIndex..] are drawn, so a stroke in progress can be extended one
 * point at a time without repainting what is already there.
 */
export function paintStroke(
  ctx: PaintContext,
  stroke: EraseStroke,
  fromIndex = 0,
): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  const { r, g, b } = stroke.color;
  ctx.save();
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = stroke.radius * 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (fromIndex === 0) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, stroke.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  const start = Math.max(1, fromIndex);
  if (start < pts.length) {
    ctx.beginPath();
    ctx.moveTo(pts[start - 1].x, pts[start - 1].y);
    for (let i = start; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Finished strokes, kept per page so a PDF keeps each page's edits while
 * paging back and forth. Plain images use page 0.
 */
export class EraseLog {
  private pages = new Map<number, EraseStroke[]>();

  strokes(page: number): readonly EraseStroke[] {
    return this.pages.get(page) ?? [];
  }

  count(page: number): number {
    return this.pages.get(page)?.length ?? 0;
  }

  push(page: number, stroke: EraseStroke): void {
    const list = this.pages.get(page);
    if (list) list.push(stroke);
    else this.pages.set(page, [stroke]);
  }

  /** Remove and return the most recent stroke on the page. */
  undo(page: number): EraseStroke | undefined {
    return this.pages.get(page)?.pop();
  }

  clearPage(page: number): void {
    this.pages.delete(page);
  }

  clearAll(): void {
    this.pages.clear();
  }
}
