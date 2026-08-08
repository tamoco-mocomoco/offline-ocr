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

/**
 * Argmax + confidence-based trailing trim.
 *
 * PARSeq は入力末尾の空パディング領域に対しても token を吐き続けて停止トークンを
 * 返さないことがある (小画像バイパス時に顕在化)。最後に高信頼度 (softmax >= confThr)
 * で予測したトークン位置を覚えておき、それ以降を打ち切ることで末尾ゴーストを除去する。
 */
export function argmaxAxis2WithConfTrim(
  data: Float32Array,
  seqLen: number,
  vocabSize: number,
  confThr: number = 0.85,
): Int32Array {
  const indices = new Int32Array(seqLen);
  let lastHighIdx = -1;

  for (let s = 0; s < seqLen; s++) {
    const offset = s * vocabSize;
    let maxVal = -Infinity;
    let maxIdx = 0;
    for (let v = 0; v < vocabSize; v++) {
      if (data[offset + v] > maxVal) {
        maxVal = data[offset + v];
        maxIdx = v;
      }
    }
    indices[s] = maxIdx;
    if (maxIdx === 0) break;

    let denom = 0;
    for (let v = 0; v < vocabSize; v++) denom += Math.exp(data[offset + v] - maxVal);
    const conf = 1 / denom;
    if (conf >= confThr) lastHighIdx = s;
  }

  // 最後の高信頼トークン以降を打ち切る (decode 側で stop token として扱われる)
  if (lastHighIdx >= 0) {
    for (let i = lastHighIdx + 1; i < seqLen; i++) indices[i] = 0;
  }
  return indices;
}

/**
 * PARSeq (CTC 系デコーダ) が入力に確信を持てないとき、同じ短いトークンを
 * スペース区切りで繰り返して max seq length を埋める挙動が観察される
 * (例: 暗背景+白ラテン文字を認識できずに `the the the ... the` を吐く)。
 *
 * 3連続以上の同一空白区切りトークンが出現した位置以降を全て捨てる。
 * - 正常な OCR 結果には空白区切りで同一トークンが3回以上並ぶことはほぼない
 *   (日本語は空白区切りが少なく、表のタブ区切り出力は上位層でしか行わない)
 * - 先頭からループしているケース (correct prefix なし) は空文字が返る
 *   → 上位層で「文字を検出できませんでした」として扱われ、fail-closed になる
 */
export function trimCtcLoopTail(text: string): string {
  const parts = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < parts.length - 2; i++) {
    if (parts[i] === parts[i + 1] && parts[i] === parts[i + 2]) {
      return parts.slice(0, i).join(" ").trimEnd();
    }
  }
  return text;
}
