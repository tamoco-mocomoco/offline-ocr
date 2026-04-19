/**
 * Transpose HWC (height, width, channels) to CHW (channels, height, width).
 */
export function hwcToChw(
  data: Float32Array,
  h: number,
  w: number,
  c: number,
): Float32Array {
  const out = new Float32Array(c * h * w);
  for (let ch = 0; ch < c; ch++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out[ch * h * w + y * w + x] = data[(y * w + x) * c + ch];
      }
    }
  }
  return out;
}

/**
 * Apply ImageNet normalization: (pixel / 255 - mean) / std
 * Input: Uint8 pixel values in HWC layout → output: Float32 normalized in HWC layout
 */
export function normalizeImageNet(
  data: Uint8ClampedArray,
  h: number,
  w: number,
): Float32Array {
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const out = new Float32Array(h * w * 3);
  for (let i = 0; i < h * w; i++) {
    const base = i * 4; // RGBA
    for (let c = 0; c < 3; c++) {
      out[i * 3 + c] = (data[base + c] / 255 - mean[c]) / std[c];
    }
  }
  return out;
}

/**
 * Normalize to [-1, 1] range with BGR flip.
 * Input: RGBA Uint8 → output: Float32 in BGR HWC layout, [-1, 1] range
 */
export function normalizeBgr(
  data: Uint8ClampedArray,
  h: number,
  w: number,
): Float32Array {
  const out = new Float32Array(h * w * 3);
  for (let i = 0; i < h * w; i++) {
    const base = i * 4;
    // BGR flip: channel 0=B(from index 2), 1=G(from index 1), 2=R(from index 0)
    out[i * 3 + 0] = 2.0 * (data[base + 2] / 255) - 1.0; // B
    out[i * 3 + 1] = 2.0 * (data[base + 1] / 255) - 1.0; // G
    out[i * 3 + 2] = 2.0 * (data[base + 0] / 255) - 1.0; // R
  }
  return out;
}

/**
 * argmax along axis for a 3D tensor [1, seqLen, vocabSize].
 * Returns indices array of length seqLen.
 */
export function argmaxAxis2(
  data: Float32Array,
  seqLen: number,
  vocabSize: number,
): Int32Array {
  const indices = new Int32Array(seqLen);
  for (let s = 0; s < seqLen; s++) {
    let maxVal = -Infinity;
    let maxIdx = 0;
    const offset = s * vocabSize;
    for (let v = 0; v < vocabSize; v++) {
      if (data[offset + v] > maxVal) {
        maxVal = data[offset + v];
        maxIdx = v;
      }
    }
    indices[s] = maxIdx;
  }
  return indices;
}
