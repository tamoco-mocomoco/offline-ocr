/**
 * Port of src/reading_order/order/reorder.py
 *
 * Sorts LINE elements within TEXTBLOCKs and the page level.
 */

import type { Element } from "../parser/ndl-parser";
import { smoothOrder } from "./smooth-order";
import { withGroupedWarichu } from "./warichu";

function checkIou(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  const aArea = (a[2] - a[0]) * (a[3] - a[1]);
  const bArea = (b[2] - b[0]) * (b[3] - b[1]);
  const ix0 = Math.max(a[0], b[0]);
  const iy0 = Math.max(a[1], b[1]);
  const ix1 = Math.min(a[2], b[2]);
  const iy1 = Math.min(a[3], b[3]);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const iArea = iw * ih;
  const minArea = Math.min(aArea, bArea);
  return minArea > 0 && iArea / minArea > 0.8;
}

function removeDup(children: Element[]): Element[] {
  const lines: Element[] = [];
  const compLines: [number, number, number, number, number][] = [];

  for (const element of children) {
    if (element.tag === "LINE" || element.tag === "WARICHUBLOCK") {
      const w = parseFloat(element.attrs.WIDTH ?? "-1");
      const h = parseFloat(element.attrs.HEIGHT ?? "-1");
      const conf = parseFloat(element.attrs.CONF ?? "-1");
      const x = parseFloat(element.attrs.X ?? "-1");
      const y = parseFloat(element.attrs.Y ?? "-1");

      if (
        lines.length > 0 &&
        (lines[lines.length - 1].tag === "LINE" || lines[lines.length - 1].tag === "WARICHUBLOCK")
      ) {
        const prev = compLines[compLines.length - 1];
        const curr: [number, number, number, number] = [x, y, x + w, y + h];
        const prevBbox: [number, number, number, number] = [prev[0], prev[1], prev[2], prev[3]];

        if (checkIou(prevBbox, curr)) {
          if (prev[4] >= conf) {
            // Skip current (prev wins)
            continue;
          } else {
            // Remove prev (current wins)
            lines.pop();
            compLines.pop();
          }
        }
      }
      lines.push(element);
      compLines.push([x, y, x + w, y + h, conf]);
    } else {
      lines.push(element);
    }
  }
  return lines;
}

function sortLinesLocal(
  root: Element,
): [Element, number] {
  let numVertical = 0;
  let numLines = 0;
  const lines: [number, number, number, Element][] = [];
  const notLines: Element[] = [];
  const widths: number[] = [];
  const heights: number[] = [];

  for (const element of root.children) {
    if (element.tag === "LINE" || element.tag === "WARICHUBLOCK") {
      const w = parseFloat(element.attrs.WIDTH ?? "-1");
      const h = parseFloat(element.attrs.HEIGHT ?? "-1");
      if (w < h) numVertical++;
      numLines++;
      widths.push(w);
      heights.push(h);
      const x = parseFloat(element.attrs.X ?? "-1");
      const y = parseFloat(element.attrs.Y ?? "-1");
      const order = parseFloat(element.attrs.ORDER ?? "NaN");
      lines.push([x + w / 2, y + h / 2, order, element]);
    } else {
      notLines.push(element);
    }
  }

  if (widths.length === 0) return [root, -1];

  const isVertical = numLines < numVertical * 2;

  // Median of spans
  const spans = isVertical ? [...widths].sort((a, b) => a - b) : [...heights].sort((a, b) => a - b);
  const spanMedian = spans[Math.floor(spans.length / 2)];
  const margin = spanMedian * 0.3;

  lines.sort((a0, a1) => {
    const [x0, y0] = a0;
    const [x1, y1] = a1;
    if (isVertical) {
      if (margin < x1 - x0) return 1;
      if (margin < x0 - x1) return -1;
      return y0 - y1;
    } else {
      if (margin < y0 - y1) return 1;
      if (margin < y1 - y0) return -1;
      return x0 - x1;
    }
  });

  let sortedLines = lines.map((l) => l[3]);
  if (sortedLines.length > 0) {
    sortedLines = removeDup(sortedLines);
  }

  // Calc median order
  const validOrders = lines
    .map((l) => l[2])
    .filter((o) => !isNaN(o))
    .sort((a, b) => a - b);
  const median =
    validOrders.length > 0 ? validOrders[Math.floor(validOrders.length / 2)] : NaN;

  root.children = [...sortedLines, ...notLines];
  return [root, median];
}

function sortLinesTraverse(pageOrBlock: Element): void {
  const toBeSorted: [number, Element][] = [];
  const unsorted: Element[] = [];

  for (const element of pageOrBlock.children) {
    if (element.tag === "TEXTBLOCK") {
      // Sort warichu inside TEXTBLOCK
      for (const child of element.children) {
        if (child.tag === "WARICHUBLOCK") {
          sortLinesLocal(child);
        }
      }
      // Sort LINEs inside TEXTBLOCK
      const [, median] = sortLinesLocal(element);
      toBeSorted.push([median, element]);
    } else if (element.tag === "LINE") {
      const order = parseFloat(element.attrs.ORDER ?? "NaN");
      toBeSorted.push([order, element]);
    } else if (element.tag === "WARICHUBLOCK") {
      const [, median] = sortLinesLocal(element);
      toBeSorted.push([median, element]);
    } else if (element.tag === "BLOCK" || element.tag === "PAGE") {
      sortLinesTraverse(element);
      unsorted.push(element);
    } else {
      unsorted.push(element);
    }
  }

  toBeSorted.sort((a, b) => a[0] - b[0]);
  let sortedChildren = toBeSorted.map((t) => t[1]);
  if (sortedChildren.length > 0) {
    sortedChildren = removeDup(sortedChildren);
  }
  pageOrBlock.children = [...sortedChildren, ...unsorted];
}

/**
 * Sort lines within the element tree (PAGE level).
 * This is the main entry point for reading order reordering.
 */
export function sortLines(root: Element, smoothing: boolean = true): void {
  withGroupedWarichu(root, () => {
    sortLinesTraverse(root);
  });
  if (smoothing) {
    smoothOrder(root);
  }
}
