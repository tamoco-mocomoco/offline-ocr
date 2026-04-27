import { describe, it, expect } from "vitest";
import { addPadding, calcPadding, type CropRect } from "../padding";

describe("addPadding", () => {
  const imageW = 1000;
  const imageH = 800;

  describe("文字だけの画像（余白なしの選択）にパディングが必要", () => {
    it("横書きテキスト1行分のタイトな選択に余白が追加される", () => {
      // ユーザーが文字ギリギリで範囲選択した場合
      const tightCrop: CropRect = { x: 100, y: 400, width: 500, height: 24 };
      const padded = addPadding(tightCrop, imageW, imageH);
      // パディング後は上下左右に余白が追加されている
      expect(padded.x).toBeLessThan(tightCrop.x);
      expect(padded.y).toBeLessThan(tightCrop.y);
      expect(padded.width).toBeGreaterThan(tightCrop.width);
      expect(padded.height).toBeGreaterThan(tightCrop.height);
    });

    it("縦書きテキスト1行分のタイトな選択に余白が追加される", () => {
      const tightCrop: CropRect = { x: 500, y: 100, width: 24, height: 500 };
      const padded = addPadding(tightCrop, imageW, imageH);
      expect(padded.x).toBeLessThan(tightCrop.x);
      expect(padded.width).toBeGreaterThan(tightCrop.width);
    });

    it("高さ24pxの選択で、パディング後は少なくとも1.5倍以上になる", () => {
      const tightCrop: CropRect = { x: 100, y: 400, width: 500, height: 24 };
      const padded = addPadding(tightCrop, imageW, imageH);
      expect(padded.height).toBeGreaterThanOrEqual(tightCrop.height * 1.5);
    });
  });

  describe("パディング計算の正確性", () => {
    it("短辺に対する比率でパディングが計算される", () => {
      const rect: CropRect = { x: 100, y: 300, width: 600, height: 40 };
      const padded = addPadding(rect, imageW, imageH, 0.5);
      // 短辺 40 × 0.5 = 20px のパディング
      const pad = 40 * 0.5;
      expect(padded.x).toBeCloseTo(rect.x - pad, 0);
      expect(padded.y).toBeCloseTo(rect.y - pad, 0);
      expect(padded.width).toBeCloseTo(rect.width + pad * 2, 0);
      expect(padded.height).toBeCloseTo(rect.height + pad * 2, 0);
    });

    it("ratio=0 ではパディングなし", () => {
      const rect: CropRect = { x: 100, y: 100, width: 300, height: 80 };
      const padded = addPadding(rect, imageW, imageH, 0);
      expect(padded).toEqual(rect);
    });

    it("デフォルトのratioでパディングが追加される", () => {
      const rect: CropRect = { x: 200, y: 200, width: 400, height: 100 };
      const padded = addPadding(rect, imageW, imageH);
      expect(padded.width).toBeGreaterThan(rect.width);
      expect(padded.height).toBeGreaterThan(rect.height);
    });
  });

  describe("画像境界でのクランプ", () => {
    it("左上の境界を超えない", () => {
      const rect: CropRect = { x: 5, y: 5, width: 200, height: 50 };
      const padded = addPadding(rect, imageW, imageH, 0.5);
      expect(padded.x).toBeGreaterThanOrEqual(0);
      expect(padded.y).toBeGreaterThanOrEqual(0);
    });

    it("右下の境界を超えない", () => {
      const rect: CropRect = { x: 850, y: 750, width: 150, height: 50 };
      const padded = addPadding(rect, imageW, imageH, 0.5);
      expect(padded.x + padded.width).toBeLessThanOrEqual(imageW);
      expect(padded.y + padded.height).toBeLessThanOrEqual(imageH);
    });
  });
});

describe("calcPadding", () => {
  it("短辺に対する比率でパディング量を計算する", () => {
    expect(calcPadding(600, 40, 0.5)).toBe(20);
  });

  it("最大値（50px）を超えない", () => {
    expect(calcPadding(500, 500, 1.0)).toBe(50);
  });

  it("ratio=0ではパディングなし", () => {
    expect(calcPadding(300, 80, 0)).toBe(0);
  });

  it("デフォルトratioで計算される", () => {
    // 短辺24 × 0.3 = 7.2 → 7
    expect(calcPadding(500, 24)).toBe(7);
  });
});
