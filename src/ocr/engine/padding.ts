/**
 * Padding utilities for OCR crop regions.
 *
 * When text is tightly selected with little or no margin, the DEIM detector
 * may fail to identify text regions. Adding padding provides the necessary
 * context for reliable detection.
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Default padding ratio: fraction of the shorter side */
const DEFAULT_RATIO = 0.3;

/** Maximum padding in pixels to avoid excessive expansion */
const MAX_PAD = 50;

/**
 * Calculate padding amount in pixels based on the crop dimensions.
 * Uses the shorter side as reference, capped at MAX_PAD.
 */
export function calcPadding(
  width: number,
  height: number,
  ratio: number = DEFAULT_RATIO,
): number {
  if (ratio <= 0) return 0;
  const shortSide = Math.min(width, height);
  return Math.min(Math.round(shortSide * ratio), MAX_PAD);
}

/**
 * Expand a crop rectangle by `ratio` of its shorter side on each edge,
 * clamped to image bounds.
 */
export function addPadding(
  rect: CropRect,
  imageW: number,
  imageH: number,
  ratio: number = DEFAULT_RATIO,
): CropRect {
  if (ratio <= 0) return { ...rect };

  const pad = calcPadding(rect.width, rect.height, ratio);

  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const right = Math.min(imageW, rect.x + rect.width + pad);
  const bottom = Math.min(imageH, rect.y + rect.height + pad);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}
