import * as ort from "onnxruntime-web/wasm";
import { resizeForParseq } from "./image-utils";
import { normalizeBgr, hwcToChw, argmaxAxis2 } from "./tensor-utils";
import { CHARSET_TRAIN } from "../config/charset";
import { type ModelConfig } from "../config/model-config";

export class PARSeqRecognizer {
  private session: ort.InferenceSession | null = null;
  private inputH = 0;
  private inputW = 0;

  async init(modelBuffer: ArrayBuffer, config: ModelConfig): Promise<void> {
    this.session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    // inputShape: [N, C, H, W]
    this.inputH = config.inputShape[2];
    this.inputW = config.inputShape[3];
  }

  /**
   * Recognize text from a line image (ImageData).
   * Follows src/parseq.py: rotate if vertical, resize, BGR flip, [-1,1] normalize, CHW.
   */
  async read(lineImage: ImageData): Promise<string> {
    if (!this.session) throw new Error("PARSeq session not initialized");

    // Preprocess: rotate if h>w, resize to (768, 32)
    const resized = resizeForParseq(
      lineImage,
      this.inputW,
      this.inputH,
      true,
    );

    // BGR flip + normalize to [-1, 1]
    const normalized = normalizeBgr(resized.data, this.inputH, this.inputW);

    // HWC → CHW
    const chw = hwcToChw(normalized, this.inputH, this.inputW, 3);

    // Create tensor
    const inputTensor = new ort.Tensor("float32", chw, [
      1,
      3,
      this.inputH,
      this.inputW,
    ]);

    const inputName = this.session.inputNames[0];
    const results = await this.session.run({ [inputName]: inputTensor });
    const outputName = this.session.outputNames[0];
    const output = results[outputName];

    // output shape: [1, seqLen, vocabSize]
    const dims = output.dims;
    const seqLen = dims[1];
    const vocabSize = dims[2];
    const data = output.data as Float32Array;

    // argmax along axis=2
    const indices = argmaxAxis2(data, seqLen, vocabSize);

    // Decode: stop at first 0 token, map index i → charset[i-1]
    let result = "";
    for (let s = 0; s < seqLen; s++) {
      const idx = indices[s];
      if (idx === 0) break; // stop token
      if (idx - 1 >= 0 && idx - 1 < CHARSET_TRAIN.length) {
        result += CHARSET_TRAIN[idx - 1];
      }
    }

    return result;
  }

  dispose(): void {
    this.session?.release();
    this.session = null;
  }
}
