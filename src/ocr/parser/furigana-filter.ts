/**
 * Filter furigana (ruby text) boxes from a detection list.
 *
 * 検出 (DEIM) と認識 (PARSeq) の間で実行することで、ふりがなが PARSeq に渡らず、
 * 文字として読まれることがなくなる。
 *
 * 判定ロジック:
 *  各ボックスについて、隣接 (gapPx 以内) するもう一方のボックスとの
 *  「短辺 = min(width, height)」を比べる。隣に自分の largeRatio (デフォルト 2 倍)
 *  以上の大きさのボックスがあれば、それは大きな本文に寄り添うふりがなとみなし除去する。
 *
 *  グローバルな中央値で判定しない理由: ふりがなが本文より数が多くなる漫画コマでは、
 *  中央値がふりがなサイズに引っ張られてしきい値が機能しなくなる。
 */

export interface FuriganaCandidate {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FuriganaFilterOptions {
  /** 隣接ボックスが自分の何倍以上の短辺だとふりがな扱いするか (default: 2.0) */
  largeRatio?: number;
  /** 隣接判定のピクセル距離閾値 (default: 30) */
  gapPx?: number;
}

const DEFAULT_LARGE_RATIO = 2.0;
const DEFAULT_GAP_PX = 30;

function shortSide(box: FuriganaCandidate): number {
  return Math.min(box.width, box.height);
}

/** 2つの矩形が gapPx 以内で隣接しているか（少なくとも一方の軸で重なり、他方が近い） */
function isAdjacent(a: FuriganaCandidate, b: FuriganaCandidate, gapPx: number): boolean {
  const horizGap = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const vertGap = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));

  // 縦書きふりがな: 横に近接 (horizGap小) かつ縦に重なり (vertGap=0)
  // 横書きふりがな: 縦に近接 (vertGap小) かつ横に重なり (horizGap=0)
  return (horizGap <= gapPx && vertGap === 0) || (vertGap <= gapPx && horizGap === 0);
}

export function filterFurigana<T extends FuriganaCandidate>(
  items: T[],
  options: FuriganaFilterOptions = {},
): T[] {
  if (items.length <= 1) return items;

  const largeRatio = options.largeRatio ?? DEFAULT_LARGE_RATIO;
  const gapPx = options.gapPx ?? DEFAULT_GAP_PX;

  return items.filter((item) => {
    const itemSize = shortSide(item);

    // 自分の largeRatio 倍以上の大きさで、かつ隣接している本文が存在すればふりがな
    const hasMuchLargerNeighbor = items.some(
      (other) =>
        other !== item &&
        shortSide(other) >= itemSize * largeRatio &&
        isAdjacent(item, other, gapPx),
    );

    return !hasMuchLargerNeighbor;
  });
}
