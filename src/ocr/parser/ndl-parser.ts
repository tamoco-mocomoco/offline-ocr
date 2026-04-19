/**
 * Port of src/ndl_parser.py — convert_to_xml_string3 and supporting functions.
 *
 * Instead of building XML strings, we produce a structured Page object
 * that the reading-order module can consume (using a simple tree of elements).
 */

import { Detection } from "../engine/deim";
import { NDL_CLASSES_LIST, nameToOrgName } from "../config/ndl-classes";

// ---- Element tree (lightweight XML substitute) ----

export interface Attrs {
  [key: string]: string;
}

export interface Element {
  tag: string;
  attrs: Attrs;
  children: Element[];
}

export function createElement(
  tag: string,
  attrs: Attrs = {},
  children: Element[] = [],
): Element {
  return { tag, attrs, children };
}

// ---- Helpers ----

function pointInPolygon(
  px: number,
  py: number,
  polygon: number[][],
): number {
  const n = polygon.length;
  let inside = false;
  let prevX = polygon[0][0];
  let prevY = polygon[0][1];
  for (let i = 1; i <= n; i++) {
    const sx = polygon[i % n][0];
    const sy = polygon[i % n][1];
    if (Math.min(prevY, sy) < py && py <= Math.max(prevY, sy) && px <= Math.max(prevX, sx)) {
      if (prevY !== sy) {
        const xinters = ((py - prevY) * (sx - prevX)) / (sy - prevY) + prevX;
        if (prevX === sx || px <= xinters) {
          inside = !inside;
        }
      }
    }
    prevX = sx;
    prevY = sy;
  }
  // Check boundary
  for (let i = 0; i < n; i++) {
    const sx = polygon[i][0];
    const sy = polygon[i][1];
    const ex = polygon[(i + 1) % n][0];
    const ey = polygon[(i + 1) % n][1];
    if (
      (sy === ey && sy === py && Math.min(sx, ex) <= px && px <= Math.max(sx, ex)) ||
      (sx === ex && sx === px && Math.min(sy, ey) <= py && py <= Math.max(sy, ey))
    ) {
      return 0;
    }
  }
  return inside ? 1 : -1;
}

function pointInPolygonDist(
  px: number,
  py: number,
  polygon: number[][],
): number {
  const n = polygon.length;
  let inside = false;
  let minDist = Infinity;
  let prevX = polygon[0][0];
  let prevY = polygon[0][1];
  for (let i = 1; i <= n; i++) {
    const sx = polygon[i % n][0];
    const sy = polygon[i % n][1];
    if (Math.min(prevY, sy) < py && py <= Math.max(prevY, sy) && px <= Math.max(prevX, sx)) {
      if (prevY !== sy) {
        const xinters = ((py - prevY) * (sx - prevX)) / (sy - prevY) + prevX;
        if (prevX === sx || px <= xinters) {
          inside = !inside;
        }
      }
    }
    // Point-line segment distance
    const lenSq = (sx - prevX) ** 2 + (sy - prevY) ** 2;
    let d: number;
    if (lenSq === 0) {
      d = Math.hypot(px - prevX, py - prevY);
    } else {
      let t = ((px - prevX) * (sx - prevX) + (py - prevY) * (sy - prevY)) / lenSq;
      t = Math.max(0, Math.min(1, t));
      d = Math.hypot(px - (prevX + t * (sx - prevX)), py - (prevY + t * (sy - prevY)));
    }
    if (d < minDist) minDist = d;
    prevX = sx;
    prevY = sy;
  }
  return inside ? minDist : -minDist;
}

type BBox = [number, number, number, number, number]; // x1, y1, x2, y2, conf

interface Polygon {
  points: number[][]; // [[x,y], ...]
}

function textblockToRect(
  textblocks: number[][],
  minBboxSize: number = 5,
): (Polygon | null)[] {
  const result: (Polygon | null)[] = [];
  for (const tb of textblocks) {
    const [xmin, ymin, xmax, ymax] = tb;
    if (xmax - xmin < minBboxSize && ymax - ymin < minBboxSize) continue;
    result.push({
      points: [
        [xmin, ymin],
        [xmin, ymax],
        [xmax, ymax],
        [xmax, ymin],
      ],
    });
  }
  return result;
}

function isInBlock(
  block: number[],
  lineOrPoly: number[] | Polygon,
): boolean {
  let cx: number, cy: number;
  if (Array.isArray(lineOrPoly) && typeof lineOrPoly[0] === "number") {
    const l = lineOrPoly as number[];
    cx = (l[0] + l[2]) / 2;
    cy = (l[1] + l[3]) / 2;
  } else {
    const poly = lineOrPoly as Polygon;
    const xs = poly.points.map((p) => p[0]);
    const ys = poly.points.map((p) => p[1]);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  return block[0] <= cx && cx <= block[2] && block[1] <= cy && cy <= block[3];
}

function makeBboxFromPoly(
  poly: Polygon,
): [number, number, number, number] {
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const [px, py] of poly.points) {
    if (px < x1) x1 = px;
    if (py < y1) y1 = py;
    if (px > x2) x2 = px;
    if (py > y2) y2 = py;
  }
  return [x1, y1, x2 - x1, y2 - y1];
}

type RelResult = [
  (number[][] | null)[], // tb_info
  (number[][] | null)[], // ad_info
  (number[][] | null)[], // table_info
  number[][], // independ_lines
];

function getRelationshipRect(
  resBbox: number[][][], // [classId][detIdx][x1,y1,x2,y2,conf]
  tbPolygons: (Polygon | null)[],
  classes: string[],
  scoreThr: number = 0.1,
): RelResult {
  const tbClsId = classes.indexOf("text_block");
  const baClsId = classes.indexOf("block_ad");
  const tableClsId = classes.indexOf("block_table");

  const tbInfo: (number[][] | null)[] = tbPolygons.map(() => []);
  const adInfo: (number[][] | null)[] = (resBbox[baClsId] ?? []).map(() => []);
  const tableInfo: (number[][] | null)[] = (resBbox[tableClsId] ?? []).map(() => []);
  const independLines: number[][] = [];

  for (let c = 0; c < classes.length; c++) {
    if (!classes[c].startsWith("line_")) continue;
    const lines = resBbox[c] ?? [];
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      if (line[4] < scoreThr) continue;

      let inAnyBlock = false;

      // Check text_block
      for (let i = 0; i < tbPolygons.length; i++) {
        if (tbPolygons[i] === null) {
          tbInfo[i] = null;
          continue;
        }
        const cx = (line[0] + line[2]) / 2;
        const cy = (line[1] + line[3]) / 2;
        if (pointInPolygon(cx, cy, tbPolygons[i]!.points) >= 0) {
          (tbInfo[i] as number[][]).push([c, j]);
          inAnyBlock = true;
          break;
        }
      }

      // Check block_ad
      if (!inAnyBlock) {
        for (let i = 0; i < (resBbox[baClsId] ?? []).length; i++) {
          if (isInBlock(resBbox[baClsId][i], line)) {
            (adInfo[i] as number[][]).push([c, j]);
            inAnyBlock = true;
            break;
          }
        }
      }

      // Check block_table
      if (!inAnyBlock) {
        for (let i = 0; i < (resBbox[tableClsId] ?? []).length; i++) {
          if (isInBlock(resBbox[tableClsId][i], line)) {
            (tableInfo[i] as number[][]).push([c, j]);
            inAnyBlock = true;
            break;
          }
        }
      }

      if (!inAnyBlock) {
        independLines.push([c, j]);
      }
    }
  }

  return [tbInfo, adInfo, tableInfo, independLines];
}

function refineTbRelationship(
  tbPolygons: (Polygon | null)[],
  tbInfo: (number[][] | null)[],
  classes: string[],
  margin: number = 50,
): (number[][] | null)[] {
  const tbClsId = classes.indexOf("text_block");

  for (let cIdx = 0; cIdx < tbPolygons.length; cIdx++) {
    if (tbPolygons[cIdx] === null || tbInfo[cIdx] === null) continue;
    for (let pIdx = 0; pIdx < tbPolygons.length; pIdx++) {
      if (cIdx === pIdx) continue;
      if (tbPolygons[pIdx] === null || tbInfo[pIdx] === null) continue;

      let allInside = true;
      for (const pt of tbPolygons[cIdx]!.points) {
        if (pointInPolygonDist(pt[0], pt[1], tbPolygons[pIdx]!.points) < -margin) {
          allInside = false;
          break;
        }
      }

      if (allInside) {
        if ((tbInfo[cIdx] as number[][]).length === 0) {
          (tbInfo[pIdx] as number[][]).push([tbClsId, cIdx]);
          tbInfo[cIdx] = null;
        } else {
          for (const childElm of tbInfo[cIdx] as number[][]) {
            (tbInfo[pIdx] as number[][]).push(childElm);
          }
          tbInfo[cIdx] = null;
        }
        break;
      }
    }
  }

  // Merge text blocks that only contain other text blocks
  for (let i = 0; i < tbInfo.length; i++) {
    if (tbInfo[i] === null) continue;
    let haveOnlyTb = true;
    for (const [cId] of tbInfo[i] as number[][]) {
      if (cId !== tbClsId) {
        haveOnlyTb = false;
        break;
      }
    }
    if (haveOnlyTb) tbInfo[i] = [];
  }

  return tbInfo;
}

// ---- Main conversion function ----

/**
 * Convert detections into a structured Element tree (PAGE with TEXTBLOCKs, LINEs, BLOCKs).
 * This is the TypeScript port of convert_to_xml_string3.
 */
export function detectionsToPage(
  imgW: number,
  imgH: number,
  imgName: string,
  detections: Detection[],
  scoreThr: number = 0.1,
  minBboxSize: number = 5,
): Element {
  const classes = NDL_CLASSES_LIST;
  const tbClsId = classes.indexOf("text_block");
  const baClsId = classes.indexOf("block_ad");
  const tableClsId = classes.indexOf("block_table");

  // Build resBbox[classId] = [[x1,y1,x2,y2,conf], ...]
  const resBbox: number[][][] = classes.map(() => []);
  // resTextblocks[0] = [[x1,y1,x2,y2], ...]
  const resTextblocks: number[][][] = [[]];

  for (const det of detections) {
    const [x1, y1, x2, y2] = det.box;
    if (det.classIndex === 0) {
      resTextblocks[0].push([x1, y1, x2, y2]);
    }
    resBbox[det.classIndex]?.push([x1, y1, x2, y2, det.confidence]);
  }

  const tbPolygons = textblockToRect(resTextblocks[0], minBboxSize);
  let [tbInfo, adInfo, tableInfo, independLines] = getRelationshipRect(
    resBbox,
    tbPolygons,
    classes,
    scoreThr,
  );
  tbInfo = refineTbRelationship(tbPolygons, tbInfo, classes, 50);

  const page = createElement("PAGE", {
    IMAGENAME: imgName,
    WIDTH: String(imgW),
    HEIGHT: String(imgH),
  });

  // Helper to create a LINE element
  function makeLine(
    cId: number,
    bbox: number[],
    conf: number,
    predCharCnt: number,
  ): Element {
    const x = Math.round(bbox[0]);
    const y = Math.round(bbox[1]);
    const w = Math.round(bbox[2] - bbox[0]);
    const h = Math.round(bbox[3] - bbox[1]);
    return createElement("LINE", {
      TYPE: nameToOrgName(classes[cId]),
      X: String(x),
      Y: String(y),
      WIDTH: String(w),
      HEIGHT: String(h),
      CONF: conf.toFixed(3),
      PRED_CHAR_CNT: predCharCnt.toFixed(3),
    });
  }

  function makeTextblockHead(polyIdx: number): Element {
    const poly = tbPolygons[polyIdx]!;
    const conf = resBbox[tbClsId][polyIdx]?.[4] ?? 0;
    const pointsStr = poly.points.map((p) => `${p[0]},${p[1]}`).join(",");
    const shape = createElement("SHAPE", {}, [
      createElement("POLYGON", { POINTS: pointsStr }),
    ]);
    return createElement(
      "TEXTBLOCK",
      { CONF: conf.toFixed(3) },
      [shape],
    );
  }

  function addLinesFromTbInfo(
    parent: Element,
    entries: number[][],
  ): void {
    for (const [cId, i] of entries) {
      const line = resBbox[cId][i];
      const conf = line[4];
      if (conf < scoreThr) continue;
      const predCharCnt = line.length >= 6 ? line[5] : 0;

      if (cId === tbClsId) {
        const [x, y, w, h] = makeBboxFromPoly(tbPolygons[i]!);
        if (w >= minBboxSize && h >= minBboxSize) {
          parent.children.push(
            createElement("LINE", {
              TYPE: nameToOrgName(classes[1]),
              X: String(Math.round(x)),
              Y: String(Math.round(y)),
              WIDTH: String(Math.round(w)),
              HEIGHT: String(Math.round(h)),
              CONF: conf.toFixed(3),
              PRED_CHAR_CNT: predCharCnt.toFixed(3),
            }),
          );
        }
      } else {
        parent.children.push(makeLine(cId, line, conf, predCharCnt));
      }
    }
  }

  // Table blocks
  for (let i = 0; i < (resBbox[tableClsId] ?? []).length; i++) {
    if (tableInfo[i] === null) continue;
    const bt = resBbox[tableClsId][i];
    const block = createElement("BLOCK", {
      TYPE: "表組",
      X: String(Math.round(bt[0])),
      Y: String(Math.round(bt[1])),
      WIDTH: String(Math.round(bt[2] - bt[0])),
      HEIGHT: String(Math.round(bt[3] - bt[1])),
      CONF: bt[4].toFixed(3),
    });
    for (const [c, j] of tableInfo[i] as number[][]) {
      if (c === tbClsId) {
        // Lines inside textblock inside table
        if (tbInfo[j] === null) continue;
        if ((tbInfo[j] as number[][]).length === 0) {
          const [x, y, w, h] = makeBboxFromPoly(tbPolygons[j]!);
          if (w >= minBboxSize && h >= minBboxSize) {
            block.children.push(
              createElement("LINE", {
                TYPE: nameToOrgName(classes[0]),
                X: String(Math.round(x)),
                Y: String(Math.round(y)),
                WIDTH: String(Math.round(w)),
                HEIGHT: String(Math.round(h)),
              }),
            );
          }
        } else {
          addLinesFromTbInfo(block, tbInfo[j] as number[][]);
        }
        tbInfo[j] = null;
      } else {
        const line = resBbox[c][j];
        if (line[4] < scoreThr) continue;
        block.children.push(makeLine(c, line, line[4], line.length >= 6 ? line[5] : 0));
      }
    }
    page.children.push(block);
  }

  // Ad blocks
  for (let i = 0; i < (resBbox[baClsId] ?? []).length; i++) {
    if (adInfo[i] === null) continue;
    const ba = resBbox[baClsId][i];
    const block = createElement("BLOCK", {
      TYPE: "広告",
      X: String(Math.round(ba[0])),
      Y: String(Math.round(ba[1])),
      WIDTH: String(Math.round(ba[2] - ba[0])),
      HEIGHT: String(Math.round(ba[3] - ba[1])),
      CONF: ba[4].toFixed(3),
    });
    for (const [c, j] of adInfo[i] as number[][]) {
      if (c === tbClsId) {
        if (tbInfo[j] === null) continue;
        const tb = makeTextblockHead(j);
        if ((tbInfo[j] as number[][]).length === 0) {
          const [x, y, w, h] = makeBboxFromPoly(tbPolygons[j]!);
          if (w >= minBboxSize && h >= minBboxSize) {
            tb.children.push(
              createElement("LINE", {
                TYPE: nameToOrgName(classes[0]),
                X: String(Math.round(x)),
                Y: String(Math.round(y)),
                WIDTH: String(Math.round(w)),
                HEIGHT: String(Math.round(h)),
              }),
            );
          }
        } else {
          addLinesFromTbInfo(tb, tbInfo[j] as number[][]);
        }
        block.children.push(tb);
        tbInfo[j] = null;
      } else {
        const line = resBbox[c][j];
        if (line[4] < scoreThr) continue;
        block.children.push(makeLine(c, line, line[4], line.length >= 6 ? line[5] : 0));
      }
    }
    page.children.push(block);
  }

  // Text blocks
  for (let j = 0; j < tbInfo.length; j++) {
    if (tbInfo[j] === null || tbPolygons[j] === null) continue;
    const tb = makeTextblockHead(j);
    if ((tbInfo[j] as number[][]).length === 0) {
      const [x, y, w, h] = makeBboxFromPoly(tbPolygons[j]!);
      if (w >= minBboxSize && h >= minBboxSize) {
        tb.children.push(
          createElement("LINE", {
            TYPE: nameToOrgName(classes[1]),
            X: String(Math.round(x)),
            Y: String(Math.round(y)),
            WIDTH: String(Math.round(w)),
            HEIGHT: String(Math.round(h)),
          }),
        );
      }
    } else {
      addLinesFromTbInfo(tb, tbInfo[j] as number[][]);
    }
    page.children.push(tb);
  }

  // Independent lines
  for (const [c, j] of independLines) {
    const line = resBbox[c][j];
    if (line[4] < scoreThr) continue;
    page.children.push(makeLine(c, line, line[4], line.length >= 6 ? line[5] : 0));
  }

  // Block elements (non-ad, non-table)
  for (let c = 0; c < classes.length; c++) {
    if (classes[c].startsWith("block_") && classes[c] !== "block_table") {
      for (const block of resBbox[c] ?? []) {
        if (block[4] < scoreThr) continue;
        page.children.push(
          createElement("BLOCK", {
            TYPE: nameToOrgName(classes[c]),
            X: String(Math.round(block[0])),
            Y: String(Math.round(block[1])),
            WIDTH: String(Math.round(block[2] - block[0])),
            HEIGHT: String(Math.round(block[3] - block[1])),
            CONF: block[4].toFixed(3),
          }),
        );
      }
    }
  }

  return page;
}

// ---- Element tree utilities ----

/**
 * Find all elements matching a tag, recursively.
 */
export function findAll(root: Element, tag: string): Element[] {
  const result: Element[] = [];
  function recurse(el: Element) {
    if (el.tag === tag) result.push(el);
    for (const child of el.children) recurse(child);
  }
  recurse(root);
  return result;
}

/**
 * Find the parent of a given child element.
 */
export function findParent(
  root: Element,
  target: Element,
): Element | null {
  for (const child of root.children) {
    if (child === target) return root;
    const found = findParent(child, target);
    if (found) return found;
  }
  return null;
}

/**
 * Serialize the element tree to XML string (for debugging / compatibility).
 */
export function elementToXml(el: Element, indent: string = ""): string {
  const attrStr = Object.entries(el.attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  if (el.children.length === 0) {
    return `${indent}<${el.tag}${attrStr}></${el.tag}>`;
  }
  const childStr = el.children
    .map((c) => elementToXml(c, indent + "  "))
    .join("\n");
  return `${indent}<${el.tag}${attrStr}>\n${childStr}\n${indent}</${el.tag}>`;
}
