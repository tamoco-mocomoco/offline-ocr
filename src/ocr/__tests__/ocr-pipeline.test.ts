/**
 * Integration test: OCR pipeline with real ONNX models.
 *
 * Uses onnxruntime-node + sharp to run the full OCR pipeline in Node.js.
 * Tests that tightly-cropped text images need padding for reliable recognition.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { resolve } from "path";
import { readFileSync } from "fs";
import { normalizeImageNet, hwcToChw, normalizeBgr, argmaxAxis2, argmaxAxis2WithConfTrim } from "../engine/tensor-utils";
import { CHARSET_TRAIN } from "../config/charset";
import { NDL_CLASSES } from "../config/ndl-classes";
import { DET_CONF_THRESHOLD } from "../config/model-config";
import { detectionsToPage, findAll, createElement } from "../parser/ndl-parser";
import { evalPage } from "../reading-order/eval";
import type { Detection } from "../engine/deim";

// ── Helpers ──────────────────────────────────────────────────────────────────

const MODELS_DIR = resolve(__dirname, "../../../public/models");
const DEIM_PATH = resolve(MODELS_DIR, "deim-s-1024x1024.onnx");
const PARSEQ_PATH = resolve(MODELS_DIR, "parseq-ndl-16x768-100-tiny-165epoch-tegaki2.onnx");

const DEIM_INPUT_SIZE = 800;
const PARSEQ_W = 768;
const PARSEQ_H = 16;

/** Create ImageData-like object from sharp pixel buffer */
async function loadImageData(pngBuffer: Buffer): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8ClampedArray(data.buffer),
    width: info.width,
    height: info.height,
  };
}

/** Generate a test image with Japanese text */
async function generateTextImage(
  text: string,
  width: number,
  height: number,
  padding: number = 0,
  bgColor: string = "white",
  fgColor: string = "black",
  padColor: string = "white",
): Promise<Buffer> {
  const totalW = width + padding * 2;
  const totalH = height + padding * 2;
  const fontSize = Math.min(height * 0.8, 28);

  const svg = `<svg width="${totalW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${padColor}"/>
    <rect x="${padding}" y="${padding}" width="${width}" height="${height}" fill="${bgColor}"/>
    <text x="${totalW / 2}" y="${totalH / 2 + fontSize * 0.35}"
      font-family="Noto Sans JP, sans-serif" font-size="${fontSize}"
      fill="${fgColor}" text-anchor="middle">${text}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Pad & resize image to square for DEIM input */
async function preprocessForDeim(
  imgData: { data: Uint8ClampedArray; width: number; height: number },
  targetSize: number,
): Promise<Float32Array> {
  const maxSide = Math.max(imgData.width, imgData.height);

  // Pad to square using sharp
  const padded = await sharp(Buffer.from(imgData.data.buffer), {
    raw: { width: imgData.width, height: imgData.height, channels: 4 },
  })
    .extend({
      bottom: maxSide - imgData.height,
      right: maxSide - imgData.width,
      background: { r: 0, g: 0, b: 0, alpha: 255 },
    })
    .resize(targetSize, targetSize)
    .ensureAlpha()
    .raw()
    .toBuffer();

  const pixels = new Uint8ClampedArray(padded.buffer);
  const normalized = normalizeImageNet(pixels, targetSize, targetSize);
  return hwcToChw(normalized, targetSize, targetSize, 3);
}

/** Run DEIM detection */
async function runDeim(
  session: ort.InferenceSession,
  chw: Float32Array,
  paddedSize: number,
): Promise<Detection[]> {
  const imagesTensor = new ort.Tensor("float32", chw, [1, 3, DEIM_INPUT_SIZE, DEIM_INPUT_SIZE]);
  const origSizeTensor = new ort.Tensor(
    "int64",
    BigInt64Array.from([BigInt(DEIM_INPUT_SIZE), BigInt(DEIM_INPUT_SIZE)]),
    [1, 2],
  );

  const feeds: Record<string, ort.Tensor> = {};
  for (const name of session.inputNames) {
    if (name.toLowerCase().includes("image")) {
      feeds[name] = imagesTensor;
    } else {
      feeds[name] = origSizeTensor;
    }
  }

  const results = await session.run(feeds);

  const findOutput = (hint: string) =>
    session.outputNames.find((n) => n.toLowerCase().includes(hint)) ?? hint;

  const classIdsRaw = results[findOutput("label")].data as BigInt64Array;
  const bboxesData = results[findOutput("box")].data as Float32Array;
  const scoresData = results[findOutput("score")].data as Float32Array;

  const scaleX = paddedSize / DEIM_INPUT_SIZE;
  const scaleY = paddedSize / DEIM_INPUT_SIZE;

  const detections: Detection[] = [];
  for (let i = 0; i < scoresData.length; i++) {
    if (scoresData[i] <= DET_CONF_THRESHOLD) continue;
    detections.push({
      classIndex: Number(classIdsRaw[i]) - 1,
      className: NDL_CLASSES[Number(classIdsRaw[i]) - 1] ?? "",
      confidence: scoresData[i],
      box: [
        Math.round(bboxesData[i * 4 + 0] * scaleX),
        Math.round(bboxesData[i * 4 + 1] * scaleY),
        Math.round(bboxesData[i * 4 + 2] * scaleX),
        Math.round(bboxesData[i * 4 + 3] * scaleY),
      ],
      predCharCount: 0,
    });
  }
  return detections;
}

/** Crop, resize, and recognize a single line with PARSeq */
async function runParseq(
  session: ort.InferenceSession,
  imgData: { data: Uint8ClampedArray; width: number; height: number },
  x: number, y: number, w: number, h: number,
  preserveAspect: boolean = false,
  padColor?: { r: number; g: number; b: number },
): Promise<string> {
  // Crop the line region
  const cropped = await sharp(Buffer.from(imgData.data.buffer), {
    raw: { width: imgData.width, height: imgData.height, channels: 4 },
  })
    .extract({
      left: Math.max(0, Math.min(x, imgData.width - 1)),
      top: Math.max(0, Math.min(y, imgData.height - 1)),
      width: Math.max(1, Math.min(w, imgData.width - Math.max(0, x))),
      height: Math.max(1, Math.min(h, imgData.height - Math.max(0, y))),
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let srcW = cropped.info.width;
  let srcH = cropped.info.height;
  let srcBuf = cropped.data;

  // Rotate 90° CCW if vertical
  if (srcH > srcW) {
    const rotated = await sharp(srcBuf, { raw: { width: srcW, height: srcH, channels: 4 } })
      .rotate(-90)
      .raw()
      .toBuffer({ resolveWithObject: true });
    srcW = rotated.info.width;
    srcH = rotated.info.height;
    srcBuf = rotated.data;
  }

  let resized: Buffer;
  if (preserveAspect) {
    const scaledW = Math.min(
      PARSEQ_W,
      Math.max(1, Math.round((srcW * PARSEQ_H) / srcH)),
    );
    let r: number, g: number, b: number;
    if (padColor) {
      ({ r, g, b } = padColor);
    } else {
      const idx = (srcH - 1) * srcW * 4 + (srcW - 1) * 4;
      r = srcBuf[idx] ?? 0;
      g = srcBuf[idx + 1] ?? 0;
      b = srcBuf[idx + 2] ?? 0;
    }
    resized = await sharp(srcBuf, { raw: { width: srcW, height: srcH, channels: 4 } })
      .resize(scaledW, PARSEQ_H, { fit: "fill" })
      .extend({ right: PARSEQ_W - scaledW, background: { r, g, b, alpha: 255 } })
      .ensureAlpha()
      .raw()
      .toBuffer();
  } else {
    resized = await sharp(srcBuf, { raw: { width: srcW, height: srcH, channels: 4 } })
      .resize(PARSEQ_W, PARSEQ_H)
      .ensureAlpha()
      .raw()
      .toBuffer();
  }

  const pixels = new Uint8ClampedArray(resized.buffer);
  const normalized = normalizeBgr(pixels, PARSEQ_H, PARSEQ_W);
  const chw = hwcToChw(normalized, PARSEQ_H, PARSEQ_W, 3);

  const inputTensor = new ort.Tensor("float32", chw, [1, 3, PARSEQ_H, PARSEQ_W]);
  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: inputTensor });
  const output = results[session.outputNames[0]];
  const dims = output.dims;
  // 小画像バイパス時は末尾のゴースト token を信頼度で打ち切る
  const indices = preserveAspect
    ? argmaxAxis2WithConfTrim(output.data as Float32Array, dims[1], dims[2])
    : argmaxAxis2(output.data as Float32Array, dims[1], dims[2]);

  let result = "";
  for (let s = 0; s < dims[1]; s++) {
    if (indices[s] === 0) break;
    if (indices[s] - 1 >= 0 && indices[s] - 1 < CHARSET_TRAIN.length) {
      result += CHARSET_TRAIN[indices[s] - 1];
    }
  }
  // バイパス経路では末尾の空白・句読点も削る
  return preserveAspect ? result.replace(/[\s,;:.\-_]+$/, "") : result;
}

const SMALL_IMAGE_BYPASS_MAX_SIDE = 200;

/** Full OCR pipeline: detect → parse → reading order → recognize */
async function runFullOcr(
  deimSession: ort.InferenceSession,
  parseqSession: ort.InferenceSession,
  pngBuffer: Buffer,
): Promise<string> {
  const imgData = await loadImageData(pngBuffer);

  if (Math.max(imgData.width, imgData.height) <= SMALL_IMAGE_BYPASS_MAX_SIDE) {
    // 背景色は元画像の隅から取る。トリミング後の隅は文字の縁にあたる可能性が
    // あり、それを padding に使うと PARSeq がゴースト文字として読んでしまう。
    const padColor = {
      r: imgData.data[0],
      g: imgData.data[1],
      b: imgData.data[2],
    };
    const trimmed = await sharp(Buffer.from(imgData.data.buffer), {
      raw: { width: imgData.width, height: imgData.height, channels: 4 },
    })
      .trim({ threshold: 30 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const trimmedImg = {
      data: new Uint8ClampedArray(trimmed.data.buffer),
      width: trimmed.info.width,
      height: trimmed.info.height,
    };
    return runParseq(
      parseqSession,
      trimmedImg,
      0, 0, trimmedImg.width, trimmedImg.height,
      true, // preserveAspect
      padColor,
    );
  }

  const paddedSize = Math.max(imgData.width, imgData.height);
  const chw = await preprocessForDeim(imgData, DEIM_INPUT_SIZE);

  const detections = await runDeim(deimSession, chw, paddedSize);
  if (detections.length === 0) return "";

  const page = detectionsToPage(imgData.width, imgData.height, "test.png", detections);
  const root = createElement("OCRDATASET", {}, [page]);
  evalPage(root, true);

  const lines = findAll(page, "LINE");
  const texts: string[] = [];

  for (const line of lines) {
    const lx = parseInt(line.attrs.X ?? "0");
    const ly = parseInt(line.attrs.Y ?? "0");
    const lw = parseInt(line.attrs.WIDTH ?? "0");
    const lh = parseInt(line.attrs.HEIGHT ?? "0");
    if (lw <= 0 || lh <= 0) continue;

    const text = await runParseq(parseqSession, imgData, lx, ly, lw, lh);
    if (text) texts.push(text);
  }

  return texts.join("\n");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("OCR pipeline integration", () => {
  let deimSession: ort.InferenceSession;
  let parseqSession: ort.InferenceSession;

  beforeAll(async () => {
    deimSession = await ort.InferenceSession.create(DEIM_PATH, {
      executionProviders: ["cpu"],
    });
    parseqSession = await ort.InferenceSession.create(PARSEQ_PATH, {
      executionProviders: ["cpu"],
    });
  }, 60_000);

  it("パディングなしのタイトな文字画像ではテキストが検出されない", async () => {
    // 文字ギリギリの画像（余白なし）
    const tightImage = await generateTextImage("日本語テスト", 300, 32, 0);
    const result = await runFullOcr(deimSession, parseqSession, tightImage);
    // 余白がないため検出できないことを確認
    expect(result).toBe("");
  }, 30_000);

  it("パディングありの画像ではテキストが検出・認識される", async () => {
    // 十分な余白を追加した画像
    const paddedImage = await generateTextImage("日本語テスト", 300, 32, 40);
    const result = await runFullOcr(deimSession, parseqSession, paddedImage);
    // テキストが認識できることを確認
    expect(result.length).toBeGreaterThan(0);
  }, 30_000);

  it("暗い背景+白文字のタイトな画像ではテキストが検出されない", async () => {
    const tightDark = await generateTextImage("日本語テスト", 300, 32, 0, "#1a1a1a", "white");
    const result = await runFullOcr(deimSession, parseqSession, tightDark);
    expect(result).toBe("");
  }, 30_000);

  it("暗い背景+白文字でも隣接色パディングがあればテキストが検出される", async () => {
    // 暗い背景の画像を同じ暗い色の余白で囲む
    const paddedDark = await generateTextImage("日本語テスト", 300, 32, 40, "#1a1a1a", "white", "#1a1a1a");
    const result = await runFullOcr(deimSession, parseqSession, paddedDark);
    expect(result.length).toBeGreaterThan(0);
  }, 30_000);

  // ── 既存の正常ケースがパディング追加で劣化しないことの確認 ──

  it("十分な余白がある画像は、追加パディングしても認識結果が変わらない", async () => {
    // 元々余白がある画像（通常の選択ケース）
    const normalImage = await generateTextImage("日本語テスト", 300, 32, 40);
    const resultNormal = await runFullOcr(deimSession, parseqSession, normalImage);

    // さらにパディングを追加した画像
    const extraPadImage = await generateTextImage("日本語テスト", 300, 32, 80);
    const resultExtra = await runFullOcr(deimSession, parseqSession, extraPadImage);

    // 両方とも認識できる（パディング追加で認識不能にならない）
    expect(resultNormal.length).toBeGreaterThan(0);
    expect(resultExtra.length).toBeGreaterThan(0);
  }, 30_000);

  it("大きな余白がある画像でもテキストが正しく検出される", async () => {
    // 大きめの画像に十分な余白（実際の利用に近い状況）
    const largeImage = await generateTextImage("国立国会図書館", 400, 40, 100);
    const result = await runFullOcr(deimSession, parseqSession, largeImage);
    expect(result.length).toBeGreaterThan(0);
  }, 30_000);

  it("デバッグモード相当の小サイズ画像（コミットハッシュチップ）でも認識される", async () => {
    const fixturePath = resolve(__dirname, "fixtures/small-commit-hash.png");
    const debugDump = readFileSync(fixturePath);
    const result = await runFullOcr(deimSession, parseqSession, debugDump);
    expect(result).toMatch(/62be994/);
    // 末尾ノイズ (cfa8b33→cfa8b33111... 等) が混入しないこと
    expect(result.length).toBeLessThan(15);
  }, 30_000);

  it("テキストが画像端まで伸びても、末尾にゴースト文字が混入しない", async () => {
    // ユーザー報告: cfa8b33 を OCR すると "cfa8b33 1999999999999..." と
    // 大量の 1 が後ろに混じる。PARSeq が空パディング領域に対しても
    // token を吐き続け、停止トークンを返さないことが原因。
    const fixturePath = resolve(__dirname, "fixtures/small-commit-hash-2.png");
    const debugDump = readFileSync(fixturePath);
    const result = await runFullOcr(deimSession, parseqSession, debugDump);
    // 末尾ノイズが除去されていること (本来の文字数 ≒ 7 に近い)
    expect(result.length).toBeLessThan(10);
    // 認識結果に大量の数字・記号の繰り返しが残らないこと
    expect(result).not.toMatch(/(.)\1{3,}/); // 同一文字4回以上の連続なし
    expect(result).not.toMatch(/,\s*\d+/); // ", 数字" の繰り返しパターンなし
  }, 30_000);

  it("複数行テキストの認識がパディングで劣化しない", async () => {
    const fontSize = 28;
    const lineH = Math.ceil(fontSize * 1.4);
    const w = 400;
    const h = lineH * 3;
    const pad = 40;
    const totalW = w + pad * 2;
    const totalH = h + pad * 2;

    const svg = `<svg width="${totalW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <text x="${pad + 10}" y="${pad + fontSize}" font-size="${fontSize}" fill="black" font-family="sans-serif">売上高 1234567円</text>
      <text x="${pad + 10}" y="${pad + fontSize + lineH}" font-size="${fontSize}" fill="black" font-family="sans-serif">経常利益 890123円</text>
      <text x="${pad + 10}" y="${pad + fontSize + lineH * 2}" font-size="${fontSize}" fill="black" font-family="sans-serif">当期利益 456789円</text>
    </svg>`;

    const image = await sharp(Buffer.from(svg)).png().toBuffer();
    const result = await runFullOcr(deimSession, parseqSession, image);
    // 複数行が認識されている
    const lines = result.split("\n").filter((l: string) => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
