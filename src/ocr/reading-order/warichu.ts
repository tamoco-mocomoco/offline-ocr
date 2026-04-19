/**
 * Port of src/reading_order/order/warichu_block.py
 *
 * Groups 割注 (warichu) LINE elements into WARICHUBLOCK elements.
 */

import { type Element, createElement, findAll, findParent } from "../parser/ndl-parser";

function parseBbox(el: Element): [number, number, number, number] {
  const x = parseInt(el.attrs.X);
  const y = parseInt(el.attrs.Y);
  const w = parseInt(el.attrs.WIDTH);
  const h = parseInt(el.attrs.HEIGHT);
  return [x, y, x + w, y + h];
}

function intersect1d(a0: number, a1: number, b0: number, b1: number): number {
  if (b1 < a0) return 0;
  if (b0 < a0) return b1 - a0;
  if (b1 < a1) return b1 - b0;
  if (b0 < a1) return a1 - b0;
  return 0;
}

function intersectBbox(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  return intersect1d(a[0], a[2], b[0], b[2]) * intersect1d(a[1], a[3], b[1], b[3]);
}

function boundingBbox(
  bboxes: [number, number, number, number][],
): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x0, y0, x1, y1] of bboxes) {
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  }
  return [minX, minY, maxX, maxY];
}

function insertBefore(parent: Element, element: Element, anchor: Element): void {
  const idx = parent.children.indexOf(anchor);
  if (idx >= 0) {
    parent.children.splice(idx, 0, element);
  }
}

interface WarichuData {
  bbox: [number, number, number, number];
  bboxOrig: [number, number, number, number];
  obj: Element;
  parent: Element;
  order: number;
}

function groupWarichu(root: Element): void {
  function applyPage(page: Element): void {
    // Unique key for indexing
    const key = "__warichu_idx__";
    let idx = 0;
    function indexElements(el: Element): void {
      el.attrs[key] = String(idx++);
      for (const child of el.children) indexElements(child);
    }
    indexElements(page);

    const warichuList: WarichuData[] = [];

    // Find all LINE with TYPE='割注'
    const allLines = findAll(page, "LINE");
    for (const line of allLines) {
      if (line.attrs.TYPE !== "割注") continue;
      const parent = findParent(page, line);
      if (!parent) continue;
      const bbox = parseBbox(line);
      warichuList.push({
        bbox: [...bbox],
        bboxOrig: [...bbox],
        obj: line,
        parent,
        order: parseFloat(line.attrs.ORDER ?? "0"),
      });
    }

    // Dilate bboxes
    for (const w of warichuList) {
      const [x0, y0, x1, y1] = w.bbox;
      const width = x1 - x0;
      const height = y1 - y0;
      const isVertical = width < height;
      if (isVertical) {
        const step = width * 0.1;
        w.bbox = [x0 - step / 2, y0, x1 + step / 2, y1];
      } else {
        const step = height * 0.1;
        w.bbox = [x0, y0 - step / 2, x1, y1 + step / 2];
      }
    }

    // Group overlapping warichu
    const grouped = new Set<number>();
    const groups: WarichuData[][] = [];

    for (let i = 0; i < warichuList.length; i++) {
      if (grouped.has(i)) continue;
      const group = [warichuList[i]];
      grouped.add(i);
      for (let j = 0; j < warichuList.length; j++) {
        if (grouped.has(j)) continue;
        if (intersectBbox(warichuList[i].bbox, warichuList[j].bbox) > 0) {
          group.push(warichuList[j]);
          grouped.add(j);
        }
      }
      groups.push(group);
    }

    // Create WARICHUBLOCK for each group
    for (const group of groups) {
      const bboxes = group.map((w) => w.bboxOrig);
      const [x0, y0, x1, y1] = boundingBbox(bboxes);
      const orders = group.map((w) => w.order);
      orders.sort((a, b) => a - b);
      const medianOrder = orders[Math.floor(orders.length / 2)];

      const block = createElement("WARICHUBLOCK", {
        X: String(x0),
        Y: String(y0),
        WIDTH: String(x1 - x0),
        HEIGHT: String(y1 - y0),
        ORDER: String(medianOrder),
      });

      for (const w of group) {
        block.children.push(w.obj);
      }

      // Detect parent (prefer TEXTBLOCK)
      let targetParent: Element | null = null;
      let anchor: Element | null = null;
      for (const w of group) {
        if (w.parent.tag === "TEXTBLOCK") {
          targetParent = w.parent;
          anchor = w.obj;
          break;
        }
      }
      if (!targetParent && group.length > 0) {
        targetParent = group[0].parent;
        anchor = group[0].obj;
      }

      if (targetParent && anchor) {
        insertBefore(targetParent, block, anchor);
        // Remove original LINE elements from their parents
        for (const w of group) {
          const idx = w.parent.children.indexOf(w.obj);
          if (idx >= 0) w.parent.children.splice(idx, 1);
        }
      }
    }

    // Clean up index keys
    function cleanIndex(el: Element): void {
      delete el.attrs[key];
      for (const child of el.children) cleanIndex(child);
    }
    cleanIndex(page);
  }

  if (root.tag === "PAGE") {
    applyPage(root);
  } else {
    for (const child of root.children) {
      if (child.tag === "PAGE") applyPage(child);
    }
  }
}

function ungroupWarichu(root: Element): void {
  function _ungroup(parent: Element): void {
    const newChildren: Element[] = [];
    for (const child of parent.children) {
      _ungroup(child);
      if (child.tag === "WARICHUBLOCK") {
        for (const sub of child.children) {
          newChildren.push(sub);
        }
      } else {
        newChildren.push(child);
      }
    }
    parent.children = newChildren;
  }
  _ungroup(root);
}

/**
 * Context manager equivalent: groups warichu, runs callback, then ungroups.
 */
export function withGroupedWarichu(root: Element, fn: () => void): void {
  groupWarichu(root);
  fn();
  ungroupWarichu(root);
}
