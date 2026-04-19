/**
 * Port of src/reading_order/xy_cut/eval.py — eval_xml
 *
 * Assigns reading order to LINE elements and sorts them.
 */

import type { Element } from "../parser/ndl-parser";
import { findAll } from "../parser/ndl-parser";
import { solveXyCut } from "./xy-cut";
import { sortLines } from "./reorder";

/**
 * Evaluate and sort a parsed page element tree.
 * Assigns ORDER attributes to LINE elements using XY-Cut,
 * then sorts using the reorder module.
 */
export function evalPage(root: Element, smoothing: boolean = true): void {
  // Find all PAGE elements
  const pages = root.tag === "PAGE" ? [root] : findAll(root, "PAGE");

  for (const page of pages) {
    const lines = findAll(page, "LINE");
    if (lines.length === 0) continue;

    // Build bboxes array
    const bboxes: number[][] = lines.map((line) => {
      const x = parseInt(line.attrs.X);
      const y = parseInt(line.attrs.Y);
      const w = parseInt(line.attrs.WIDTH);
      const h = parseInt(line.attrs.HEIGHT);
      return [x, y, x + w, y + h];
    });

    // Solve reading order
    const ranks = solveXyCut(bboxes);

    // Assign ORDER to each LINE
    for (let i = 0; i < lines.length; i++) {
      lines[i].attrs.ORDER = String(ranks[i]);
    }

    // Sort lines
    sortLines(page, smoothing);
  }
}
