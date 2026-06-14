/**
 * Tests for furigana (ruby text) filter.
 *
 * 漫画やルビ付き文章では、DEIM が漢字本文とふりがなを別々のテキスト領域として
 * 検出してしまい、結果がぐちゃぐちゃに混ざる。
 *
 * 例: 「一番可能性を持ってるんだよ 玄弥」(本文) + 「いちばんかのうせい も げんや」(ふりがな)
 *      → 「いちばんかのうせい / 一番可能性を / 持ってるんだよ / も / げんや / 玄弥」
 *
 * このフィルタは、本文に比べて小さく、かつ本文に隣接しているボックスをふりがなとみなして
 * 除去する。除去は検出 (DEIM) と認識 (PARSeq) の間で行うので、ふりがなが文字として
 * 読まれることはない。
 */

import { describe, it, expect } from "vitest";
import { filterFurigana, type FuriganaCandidate } from "../furigana-filter";

type Box = FuriganaCandidate & { id: string };

const box = (id: string, x: number, y: number, width: number, height: number): Box => ({
  id,
  x,
  y,
  width,
  height,
});

describe("filterFurigana", () => {
  it("ふりがながない場合は入力をそのまま返す", () => {
    const lines: Box[] = [
      box("main1", 100, 50, 40, 280),
      box("main2", 200, 50, 40, 280),
    ];
    expect(filterFurigana(lines)).toEqual(lines);
  });

  it("縦書き本文の右側にある小さいボックスをふりがなとして除去する", () => {
    const main = box("main", 100, 50, 40, 300);
    const furi = box("furi", 145, 50, 14, 80); // 本文の右隣・小さい
    expect(filterFurigana([main, furi])).toEqual([main]);
  });

  it("孤立した小さいボックス（隣に大きな本文がない）は除去しない", () => {
    const small = box("isolated", 0, 0, 14, 80);
    const farAway = box("far", 500, 0, 40, 300);
    const result = filterFurigana([small, farAway]);
    expect(result.map((l) => l.id).sort()).toEqual(["far", "isolated"]);
  });

  it("複数の本文列＋それぞれにふりがながある場合、ふりがなだけ除去する", () => {
    const lines: Box[] = [
      box("main1", 100, 50, 40, 300),
      box("furi1", 145, 50, 14, 80),
      box("main2", 200, 50, 40, 300),
      box("furi2", 245, 50, 14, 60),
    ];
    const result = filterFurigana(lines);
    expect(result.map((l) => l.id)).toEqual(["main1", "main2"]);
  });

  it("実例: 一番可能性を / 持ってるんだよ / 玄弥 + ふりがな", () => {
    // ユーザー報告の漫画コマと同じレイアウト
    // 縦書き3列。右側にふりがな。
    const lines: Box[] = [
      // 本文 (右→左の順)
      box("main_ichiban", 220, 60, 38, 270), // 一番可能性を
      box("main_motte", 140, 60, 38, 320), // 持ってるんだよ
      box("main_genya", 70, 60, 38, 100), // 玄弥

      // ふりがな (各漢字の右側)
      box("furi_ichiban", 263, 60, 12, 100), // いちばん (一番)
      box("furi_kanousei", 263, 170, 12, 130), // かのうせい (可能性)
      box("furi_mo", 183, 60, 12, 28), // も (持)
      box("furi_genya", 113, 60, 12, 50), // げんや (玄弥)
    ];

    const result = filterFurigana(lines);
    const ids = result.map((l) => l.id);

    expect(ids).toContain("main_ichiban");
    expect(ids).toContain("main_motte");
    expect(ids).toContain("main_genya");

    expect(ids).not.toContain("furi_ichiban");
    expect(ids).not.toContain("furi_kanousei");
    expect(ids).not.toContain("furi_mo");
    expect(ids).not.toContain("furi_genya");
  });

  it("横書きの本文の上にあるふりがなも除去する", () => {
    const main = box("main", 50, 100, 280, 36); // 横長
    const furi = box("furi", 50, 78, 100, 14); // 本文の上・小さい
    const result = filterFurigana([main, furi]);
    expect(result.map((l) => l.id)).toEqual(["main"]);
  });

  it("空配列を渡しても落ちない", () => {
    expect(filterFurigana([])).toEqual([]);
  });

  it("ボックスが1個だけのときは除去しない（比較対象がない）", () => {
    const only = box("single", 100, 100, 14, 80);
    expect(filterFurigana([only])).toEqual([only]);
  });
});
