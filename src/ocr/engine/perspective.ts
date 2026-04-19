/** Point with x, y coordinates */
export interface Point {
  x: number;
  y: number;
}

/**
 * Solve an 8x9 augmented matrix using Gaussian elimination with partial pivoting.
 * Returns array of 8 unknowns.
 */
function solveLinearSystem(A: number[][]): number[] {
  const n = 8;
  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    let maxVal = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > maxVal) {
        maxVal = Math.abs(A[row][col]);
        maxRow = row;
      }
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];

    const pivot = A[col][col];
    if (Math.abs(pivot) < 1e-12) throw new Error("Singular matrix");

    for (let j = col; j <= n; j++) A[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = A[row][col];
      for (let j = col; j <= n; j++) A[row][j] -= factor * A[col][j];
    }
  }
  return A.map((row) => row[n]);
}

/**
 * Compute a 3x3 homography matrix from 4 source → 4 destination point pairs.
 * Returns flat array [h0..h7, 1] (row-major 3x3).
 */
export function computeHomography(src: Point[], dst: Point[]): number[] {
  // Build 8x9 augmented matrix for 8 unknowns h0..h7 (h8 = 1)
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y, X]);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y, Y]);
  }
  const h = solveLinearSystem(A);
  return [...h, 1]; // h0..h7, h8=1
}

/**
 * Invert a 3x3 matrix (flat row-major array of 9 elements).
 */
function invert3x3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error("Matrix not invertible");
  const invDet = 1 / det;
  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

/**
 * Apply perspective transform to produce a new image.
 * Uses inverse mapping with bilinear interpolation.
 */
export function applyPerspective(
  srcData: ImageData,
  matrix: number[],
  outW: number,
  outH: number,
): ImageData {
  const inv = invert3x3(matrix);
  const sw = srcData.width;
  const sh = srcData.height;
  const srcPx = srcData.data;
  const out = new ImageData(outW, outH);
  const dstPx = out.data;

  for (let dy = 0; dy < outH; dy++) {
    for (let dx = 0; dx < outW; dx++) {
      // Inverse map: destination → source
      const w = inv[6] * dx + inv[7] * dy + inv[8];
      const sx = (inv[0] * dx + inv[1] * dy + inv[2]) / w;
      const sy = (inv[3] * dx + inv[4] * dy + inv[5]) / w;

      // Bilinear interpolation
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      if (x0 < 0 || y0 < 0 || x1 >= sw || y1 >= sh) {
        // Out of bounds → black
        const di = (dy * outW + dx) * 4;
        dstPx[di + 3] = 255;
        continue;
      }

      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;

      const di = (dy * outW + dx) * 4;
      dstPx[di] = srcPx[i00] * w00 + srcPx[i10] * w10 + srcPx[i01] * w01 + srcPx[i11] * w11;
      dstPx[di + 1] = srcPx[i00 + 1] * w00 + srcPx[i10 + 1] * w10 + srcPx[i01 + 1] * w01 + srcPx[i11 + 1] * w11;
      dstPx[di + 2] = srcPx[i00 + 2] * w00 + srcPx[i10 + 2] * w10 + srcPx[i01 + 2] * w01 + srcPx[i11 + 2] * w11;
      dstPx[di + 3] = 255;
    }
  }

  return out;
}
