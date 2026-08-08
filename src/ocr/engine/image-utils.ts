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
 * Border から dominant (面積割合の一番大きい) 色を返す。
 * 1 pixel だけ見ると断片ピクセルを引いてしまう可能性があるため、
 * 上下左右の枠全体を集計して多数派を選ぶ。
 */
/**
 * PARSeq (NDL の tegaki2 モデル) は「白背景・黒文字」の分布で学習されており、
 * 暗背景・明文字 (GitHub dark theme のリンクチップなど) では認識できずに CTC
 * ループを吐きがち。背景色が暗い場合は色を反転させて分布を合わせる。
 *
 * 判定は border 全体の dominant color の輝度 (Rec. 709 相当) が閾値未満か。
 * 判定と反転処理を分けているのは、呼び出し側で bg を既に計算しているケースが
 * 多いため。
 */
export function shouldInvertForParseq(bg: {
  r: number;
  g: number;
  b: number;
}): boolean {
  // Rec. 709 luma. 暗背景の判定閾値は 90/255 に設定 (dark GitHub #0d1117 は
  // luma ~15, light GitHub #ffffff は 255, mid gray #808080 は 128)。
  const luma = 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b;
  return luma < 90;
}

export function invertColors(src: ImageData): ImageData {
  const { data, width, height } = src;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = 255 - data[i];
    out[i + 1] = 255 - data[i + 1];
    out[i + 2] = 255 - data[i + 2];
    out[i + 3] = data[i + 3];
  }
  return new ImageData(out, width, height);
}

export function dominantBorderColor(src: ImageData): { r: number; g: number; b: number } {
  const { data, width, height } = src;
  const buckets = new Map<string, number>();
  const bin = (v: number) => v >> 4; // 16-level quantization per channel
  const bump = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const key = `${bin(data[i])}-${bin(data[i + 1])}-${bin(data[i + 2])}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < width; x++) { bump(x, 0); bump(x, height - 1); }
  for (let y = 0; y < height; y++) { bump(0, y); bump(width - 1, y); }
  let bestKey = "0-0-0";
  let bestCount = 0;
  for (const [k, c] of buckets) if (c > bestCount) { bestCount = c; bestKey = k; }
  const [rq, gq, bq] = bestKey.split("-").map(Number);
  return { r: (rq << 4) | 8, g: (gq << 4) | 8, b: (bq << 4) | 8 };
}

/**
 * 行ごとのインク量プロファイルから、連続する ink 行のうち最大の高さを持つ帯を
 * 「本文行」とみなしてクロップ。上下に隣接行の文字断片 (line fragments) が
 * 数ピクセルだけ写っていても、それらは細い帯として弾かれ、本文行だけが残る。
 */
export function extractMainTextBand(
  src: ImageData,
  bg?: { r: number; g: number; b: number },
  threshold: number = 40,
): ImageData {
  const { data, width, height } = src;
  const cbg = bg ?? dominantBorderColor(src);
  const th2 = threshold * threshold;
  const rowInk = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dr = data[i] - cbg.r;
      const dg = data[i + 1] - cbg.g;
      const db = data[i + 2] - cbg.b;
      if (dr * dr + dg * dg + db * db > th2) rowInk[y]++;
    }
  }
  const bands: { start: number; end: number }[] = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const inkOn = y < height && rowInk[y] > 0;
    if (inkOn) {
      if (start === -1) start = y;
    } else if (start !== -1) {
      bands.push({ start, end: y });
      start = -1;
    }
  }
  if (bands.length === 0) return src;
  const main = bands.reduce((max, b) =>
    b.end - b.start > max.end - max.start ? b : max,
  bands[0]);
  return cropImageData(src, 0, main.start, width, main.end - main.start);
}

/**
 * Trim uniform edge-color padding from an ImageData. Used to strip the
 * adjacent-color padding added before detection when we bypass DEIM for
 * small images, so PARSeq sees mostly text instead of mostly padding.
 */
export function trimEdgeColor(src: ImageData, threshold: number = 30): ImageData {
  const { width: w, height: h, data } = src;
  if (w <= 1 || h <= 1) return src;
  const cr = data[0], cg = data[1], cb = data[2];
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (
        Math.abs(data[i] - cr) > threshold ||
        Math.abs(data[i + 1] - cg) > threshold ||
        Math.abs(data[i + 2] - cb) > threshold
      ) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return src;
  return cropImageData(src, minX, minY, maxX - minX + 1, maxY - minY + 1);
}

/**
 * Resize an ImageData to target width/height.
 * If height > width, rotates 90 degrees first (for PARSeq).
 * When preserveAspect is true, fits the image to the target height while
 * preserving aspect ratio and pads the remaining width with the edge color
 * (used by the small-image bypass so characters aren't horizontally stretched).
 */
export function resizeForParseq(
  src: ImageData,
  targetW: number,
  targetH: number,
  rotateIfVertical: boolean = true,
  preserveAspect: boolean = false,
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

  if (preserveAspect) {
    const srcW = drawSource.width;
    const srcH = drawSource.height;
    const scaledW = Math.min(
      targetW,
      Math.max(1, Math.round((srcW * targetH) / srcH)),
    );
    // Sample edge color from the source bottom-right corner for the pad.
    const sampleCanvas = new OffscreenCanvas(1, 1);
    const sampleCtx = sampleCanvas.getContext("2d")!;
    sampleCtx.drawImage(drawSource, srcW - 1, srcH - 1, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = sampleCtx.getImageData(0, 0, 1, 1).data;
    outCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    outCtx.fillRect(0, 0, targetW, targetH);
    outCtx.drawImage(drawSource, 0, 0, scaledW, targetH);
  } else {
    outCtx.drawImage(drawSource, 0, 0, targetW, targetH);
  }
  return outCtx.getImageData(0, 0, targetW, targetH);
}
