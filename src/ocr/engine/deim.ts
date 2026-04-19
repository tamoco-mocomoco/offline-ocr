import * as ort from "onnxruntime-web/wasm";
import { padAndResize } from "./image-utils";
import { normalizeImageNet, hwcToChw } from "./tensor-utils";
import { NDL_CLASSES } from "../config/ndl-classes";
import { DET_CONF_THRESHOLD, type ModelConfig } from "../config/model-config";

export interface Detection {
  classIndex: number;
  className: string;
  confidence: number;
  box: [number, number, number, number]; // x1, y1, x2, y2
  predCharCount: number;
}

export class DEIMDetector {
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

  async detect(imageData: ImageData): Promise<Detection[]> {
    if (!this.session) throw new Error("DEIM session not initialized");

    const paddedSize = Math.max(imageData.width, imageData.height);

    // Preprocess: pad to square, resize to 800x800
    const padded = padAndResize(imageData, this.inputH);

    // ImageNet normalize (HWC)
    const normalized = normalizeImageNet(padded.data, this.inputH, this.inputW);

    // HWC → CHW
    const chw = hwcToChw(normalized, this.inputH, this.inputW, 3);

    // Create input tensors
    const imagesTensor = new ort.Tensor("float32", chw, [1, 3, this.inputH, this.inputW]);
    const origSizeTensor = new ort.Tensor(
      "int64",
      BigInt64Array.from([BigInt(this.inputH), BigInt(this.inputW)]),
      [1, 2],
    );

    // 入出力名はモデルのメタデータから動的に取得
    const feeds: Record<string, ort.Tensor> = {};
    for (const name of this.session.inputNames) {
      if (name.toLowerCase().includes("image")) {
        feeds[name] = imagesTensor;
      } else {
        feeds[name] = origSizeTensor;
      }
    }

    const results = await this.session.run(feeds);

    return this.postprocess(results, paddedSize);
  }

  private postprocess(
    results: ort.InferenceSession.OnnxValueMapType,
    paddedSize: number,
  ): Detection[] {
    // 出力名はモデルから動的に解決
    const outputNames = this.session!.outputNames;
    const findOutput = (hint: string) =>
      outputNames.find((n) => n.toLowerCase().includes(hint)) ?? hint;

    const classIdsRaw = results[findOutput("label")].data as BigInt64Array;
    const bboxesData = results[findOutput("box")].data as Float32Array;
    const scoresData = results[findOutput("score")].data as Float32Array;
    // char_count が無いモデルにも対応
    const charCountOutput = results[findOutput("char_count")];
    const charCountsRaw = charCountOutput
      ? (charCountOutput.data as BigInt64Array)
      : null;

    const scaleX = paddedSize / this.inputW;
    const scaleY = paddedSize / this.inputH;

    const detections: Detection[] = [];

    for (let i = 0; i < scoresData.length; i++) {
      const score = scoresData[i];
      if (score <= DET_CONF_THRESHOLD) continue;

      const bx1 = Math.round(bboxesData[i * 4 + 0] * scaleX);
      const by1 = Math.round(bboxesData[i * 4 + 1] * scaleY);
      const bx2 = Math.round(bboxesData[i * 4 + 2] * scaleX);
      const by2 = Math.round(bboxesData[i * 4 + 3] * scaleY);

      // 1-indexed → 0-indexed
      const classIndex = Number(classIdsRaw[i]) - 1;

      detections.push({
        classIndex,
        className: NDL_CLASSES[classIndex] ?? `class_${classIndex}`,
        confidence: score,
        box: [bx1, by1, bx2, by2],
        predCharCount: charCountsRaw ? Number(charCountsRaw[i]) : 0,
      });
    }

    return detections;
  }

  dispose(): void {
    this.session?.release();
    this.session = null;
  }
}
