/**
 * Decode an image (File/Blob) into an ImageData.
 */
export async function decodeImage(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Pad an image to a square (max side) and resize to targetSize x targetSize.
 * Returns RGBA ImageData.
 */
export function padAndResize(
  src: ImageData,
  targetSize: number,
): ImageData {
  const maxSide = Math.max(src.width, src.height);
  // Create padded square canvas
  const padCanvas = new OffscreenCanvas(maxSide, maxSide);
  const padCtx = padCanvas.getContext("2d")!;
  padCtx.fillStyle = "#000";
  padCtx.fillRect(0, 0, maxSide, maxSide);
  padCtx.putImageData(src, 0, 0);

  // Resize to target
  const outCanvas = new OffscreenCanvas(targetSize, targetSize);
  const outCtx = outCanvas.getContext("2d")!;
  outCtx.drawImage(padCanvas, 0, 0, targetSize, targetSize);
  return outCtx.getImageData(0, 0, targetSize, targetSize);
}

/**
 * Crop a region from an ImageData.
 */
export function cropImageData(
  src: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
): ImageData {
  // Clamp to image bounds
  const x0 = Math.max(0, Math.min(x, src.width));
  const y0 = Math.max(0, Math.min(y, src.height));
  const x1 = Math.max(0, Math.min(x + w, src.width));
  const y1 = Math.max(0, Math.min(y + h, src.height));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw <= 0 || ch <= 0) {
    return new ImageData(1, 1);
  }
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext("2d")!;
  // Use putImageData with source offsets
  const srcCanvas = new OffscreenCanvas(src.width, src.height);
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.putImageData(src, 0, 0);
  ctx.drawImage(srcCanvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch);
}

/**
 * Resize an ImageData to target width/height.
 * If height > width, rotates 90 degrees first (for PARSeq).
 */
export function resizeForParseq(
  src: ImageData,
  targetW: number,
  targetH: number,
  rotateIfVertical: boolean = true,
): ImageData {
  let sourceCanvas = new OffscreenCanvas(src.width, src.height);
  let sourceCtx = sourceCanvas.getContext("2d")!;
  sourceCtx.putImageData(src, 0, 0);

  let drawSource: OffscreenCanvas = sourceCanvas;

  if (rotateIfVertical && src.height > src.width) {
    // Rotate 90 degrees counter-clockwise (matches cv2.ROTATE_90_COUNTERCLOCKWISE).
    // Vertical Japanese text reads top→bottom; after CCW rotation the top goes
    // to the left, producing left→right reading order that PARSeq expects.
    const rotCanvas = new OffscreenCanvas(src.height, src.width);
    const rotCtx = rotCanvas.getContext("2d")!;
    rotCtx.translate(0, src.width);
    rotCtx.rotate(-Math.PI / 2);
    rotCtx.drawImage(sourceCanvas, 0, 0);
    drawSource = rotCanvas;
  }

  const outCanvas = new OffscreenCanvas(targetW, targetH);
  const outCtx = outCanvas.getContext("2d")!;
  outCtx.drawImage(drawSource, 0, 0, targetW, targetH);
  return outCtx.getImageData(0, 0, targetW, targetH);
}
