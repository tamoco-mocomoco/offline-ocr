export type RecognizedLine = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Join recognized lines into a single output string, inserting TAB between
 * lines that look like cells on the same row of a table/receipt, and NEWLINE
 * otherwise.
 *
 * Heuristic for "same row":
 *  - Both lines are horizontally oriented (w > h). Vertical Japanese text
 *    yields tall narrow lines (h > w); we never tab-join those because each
 *    "line" is an entire column.
 *  - Their vertical extents overlap by more than half the shorter line's
 *    height. This is tolerant to small detection-noise misalignments while
 *    still rejecting adjacent body paragraph lines.
 *
 * The reading-order pass upstream has already sorted the lines, so we only
 * need to walk them in order and pick the separator for each gap.
 */
export function joinLinesWithRowDetection(
  lines: ReadonlyArray<RecognizedLine>,
): string {
  const valid = lines.filter((l) => l.text.length > 0);
  let out = "";
  for (let i = 0; i < valid.length; i++) {
    const line = valid[i];
    if (i === 0) {
      out = line.text;
      continue;
    }
    const prev = valid[i - 1];
    let sep = "\n";
    const prevHorizontal = prev.w > prev.h;
    const curHorizontal = line.w > line.h;
    if (prevHorizontal && curHorizontal) {
      const overlap =
        Math.min(prev.y + prev.h, line.y + line.h) -
        Math.max(prev.y, line.y);
      const minH = Math.min(prev.h, line.h);
      if (minH > 0 && overlap > minH * 0.5) sep = "\t";
    }
    out += sep + line.text;
  }
  return out;
}
