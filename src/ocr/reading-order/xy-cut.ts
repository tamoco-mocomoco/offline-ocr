/**
 * Port of src/reading_order/xy_cut/block_xy_cut.py
 *
 * XY-Cut algorithm for document layout block segmentation and reading order.
 */

class BlockNode {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  parent: BlockNode | null;
  children: BlockNode[] = [];
  lineIdx: number[] = [];
  numLines = 0;
  numVerticalLines = 0;

  constructor(x0: number, y0: number, x1: number, y1: number, parent: BlockNode | null) {
    this.x0 = Math.floor(x0);
    this.y0 = Math.floor(y0);
    this.x1 = Math.floor(x1);
    this.y1 = Math.floor(y1);
    this.parent = parent;
  }

  getCoords(): [number, number, number, number] {
    return [this.x0, this.y0, this.x1, this.y1];
  }

  isXSplit(): boolean {
    const [, y0, , y1] = this.getCoords();
    for (const child of this.children) {
      const [, c0, , c1] = child.getCoords();
      if (y0 !== c0 || y1 !== c1) return false;
    }
    return true;
  }

  isVertical(): boolean {
    return this.numLines < this.numVerticalLines * 2;
  }
}

function calcMinSpan(hist: Float64Array): [number, number, number] {
  if (hist.length <= 1) return [0, 1, 0];
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < hist.length; i++) {
    if (hist[i] < minVal) minVal = hist[i];
    if (hist[i] > maxVal) maxVal = hist[i];
  }
  // Find longest run of min values
  let bestStart = 0, bestEnd = 0, bestLen = 0;
  let start = -1;
  for (let i = 0; i <= hist.length; i++) {
    if (i < hist.length && hist[i] === minVal) {
      if (start < 0) start = i;
    } else {
      if (start >= 0) {
        const len = i - start;
        if (len > bestLen) {
          bestLen = len;
          bestStart = start;
          bestEnd = i;
        }
        start = -1;
      }
    }
  }
  const val = maxVal > 0 ? -minVal / maxVal : 0;
  return [bestStart, bestEnd, val];
}

function calcHist(
  table: Int32Array,
  tableW: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [Float64Array, Float64Array] {
  const xHist = new Float64Array(x1 - x0);
  const yHist = new Float64Array(y1 - y0);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = table[y * tableW + x];
      xHist[x - x0] += v;
      yHist[y - y0] += v;
    }
  }
  return [xHist, yHist];
}

function split(
  parent: BlockNode,
  table: Int32Array,
  tableW: number,
  x0?: number,
  y0?: number,
  x1?: number,
  y1?: number,
): void {
  x0 = x0 ?? parent.x0;
  y0 = y0 ?? parent.y0;
  x1 = x1 ?? parent.x1;
  y1 = y1 ?? parent.y1;
  if (!(x0 < x1 && y0 < y1)) return;
  const [px0, py0, px1, py1] = parent.getCoords();
  if (x0 === px0 && y0 === py0 && x1 === px1 && y1 === py1) return;
  const child = new BlockNode(x0, y0, x1, y1, parent);
  parent.children.push(child);
  blockXyCut(table, tableW, child);
}

function splitX(
  parent: BlockNode,
  table: Int32Array,
  tableW: number,
  x0: number,
  x1: number,
): void {
  split(parent, table, tableW, undefined, undefined, x0, undefined);
  split(parent, table, tableW, x0, undefined, x1, undefined);
  split(parent, table, tableW, x1, undefined, undefined, undefined);
}

function splitY(
  parent: BlockNode,
  table: Int32Array,
  tableW: number,
  y0: number,
  y1: number,
): void {
  split(parent, table, tableW, undefined, undefined, undefined, y0);
  split(parent, table, tableW, undefined, y0, undefined, y1);
  split(parent, table, tableW, undefined, y1, undefined, undefined);
}

function blockXyCut(table: Int32Array, tableW: number, node: BlockNode): void {
  const [x0, y0, x1, y1] = node.getCoords();
  const [xHist, yHist] = calcHist(table, tableW, x0, y0, x1, y1);

  let [xBeg, xEnd, xVal] = calcMinSpan(xHist);
  let [yBeg, yEnd, yVal] = calcMinSpan(yHist);
  xBeg += x0;
  xEnd += x0;
  yBeg += y0;
  yEnd += y0;

  if (x0 === xBeg && x1 === xEnd && y0 === yBeg && y1 === yEnd) return;

  if (yVal < xVal) {
    splitX(node, table, tableW, xBeg, xEnd);
  } else if (xVal < yVal) {
    splitY(node, table, tableW, yBeg, yEnd);
  } else if (xEnd - xBeg < yEnd - yBeg) {
    splitY(node, table, tableW, yBeg, yEnd);
  } else {
    splitX(node, table, tableW, xBeg, xEnd);
  }
}

function getOptimalGrid(numBboxes: number): number {
  return 100 * Math.sqrt(numBboxes);
}

function normalizeBboxes(
  bboxes: number[][],
  grid: number,
): number[][] {
  const n = bboxes.length;
  const result = bboxes.map((b) => [...b]);

  // Make width/height non-negative
  for (let i = 0; i < n; i++) {
    if (result[i][0] >= result[i][2]) result[i][2] = result[i][0];
    if (result[i][1] >= result[i][3]) result[i][3] = result[i][1];
  }

  // Coarse-grain
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    if (result[i][0] < xMin) xMin = result[i][0];
    if (result[i][1] < yMin) yMin = result[i][1];
    if (result[i][2] > xMax) xMax = result[i][2];
    if (result[i][3] > yMax) yMax = result[i][3];
  }

  const wPage = xMax - xMin;
  const hPage = yMax - yMin;
  if (wPage <= 0 || hPage <= 0) return result;

  const xGrid = wPage < hPage ? grid : grid * (wPage / hPage);
  const yGrid = hPage < wPage ? grid : grid * (hPage / wPage);

  for (let i = 0; i < n; i++) {
    result[i][0] = Math.max(0, Math.floor(((result[i][0] - xMin) * xGrid) / wPage));
    result[i][1] = Math.max(0, Math.floor(((result[i][1] - yMin) * yGrid) / hPage));
    result[i][2] = Math.max(0, Math.floor(((result[i][2] - xMin) * xGrid) / wPage));
    result[i][3] = Math.max(0, Math.floor(((result[i][3] - yMin) * yGrid) / hPage));
  }

  return result;
}

function makeMeshTable(bboxes: number[][]): [Int32Array, number] {
  let xGrid = 0, yGrid = 0;
  for (const b of bboxes) {
    if (b[2] + 1 > xGrid) xGrid = b[2] + 1;
    if (b[3] + 1 > yGrid) yGrid = b[3] + 1;
  }
  const table = new Int32Array(yGrid * xGrid);
  for (const b of bboxes) {
    for (let y = b[1]; y < b[3]; y++) {
      for (let x = b[0]; x < b[2]; x++) {
        table[y * xGrid + x] = 1;
      }
    }
  }
  return [table, xGrid];
}

function getRanking(node: BlockNode, ranks: number[], rank: number): number {
  for (const i of node.lineIdx) {
    ranks[i] = rank;
    rank++;
  }
  for (const child of node.children) {
    rank = getRanking(child, ranks, rank);
  }
  return rank;
}

function calcIou(box: number[], boxes: number[][]): number[] {
  const result: number[] = [];
  for (const b of boxes) {
    const x0 = Math.max(box[0], b[0]);
    const y0 = Math.max(box[1], b[1]);
    const x1 = Math.min(box[2], b[2]);
    const y1 = Math.min(box[3], b[3]);
    const inter = Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
    const area1 = (box[2] - b[0] + 1) * (box[3] - b[1] + 1);
    const area2 = (b[2] - box[0] + 1) * (b[3] - box[1] + 1);
    const union = area1 + area2 - inter;
    result.push(union > 0 ? inter / union : 0);
  }
  return result;
}

function getBlockNodeBboxes(
  root: BlockNode,
): [number[][], number[][]] {
  const bboxes: number[][] = [];
  const routers: number[][] = [];

  function collect(node: BlockNode, router: number[]): void {
    if (node.children.length === 0) {
      bboxes.push(node.getCoords());
      routers.push([...router]);
    }
    for (let i = 0; i < node.children.length; i++) {
      collect(node.children[i], [...router, i]);
    }
  }
  collect(root, []);
  return [routers, bboxes];
}

function routeTree(root: BlockNode, router: number[]): BlockNode {
  let node = root;
  for (const i of router) {
    node = node.children[i];
  }
  return node;
}

function assignBboxToNode(root: BlockNode, bboxes: number[][]): void {
  const [routers, leaves] = getBlockNodeBboxes(root);
  for (let i = 0; i < bboxes.length; i++) {
    const ious = calcIou(bboxes[i], leaves);
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let j = 0; j < ious.length; j++) {
      if (ious[j] > maxVal || (isNaN(maxVal) && !isNaN(ious[j]))) {
        maxVal = ious[j];
        maxIdx = j;
      }
    }
    routeTree(root, routers[maxIdx]).lineIdx.push(i);
  }
}

function sortNodes(node: BlockNode, bboxes: number[][]): [number, number] {
  if (node.lineIdx.length > 0) {
    let numVert = 0;
    for (const idx of node.lineIdx) {
      const w = bboxes[idx][2] - bboxes[idx][0];
      const h = bboxes[idx][3] - bboxes[idx][1];
      if (w < h) numVert++;
    }
    node.numLines = node.lineIdx.length;
    node.numVerticalLines = numVert;

    if (node.lineIdx.length > 1) {
      const isVert = node.isVertical();
      // lexsort equivalent
      const sorted = [...node.lineIdx].sort((a, b) => {
        if (isVert) {
          // Primary: -x0 (descending), Secondary: y0 (ascending)
          const dx = -bboxes[a][0] + bboxes[b][0];
          if (dx !== 0) return dx;
          return bboxes[a][1] - bboxes[b][1];
        } else {
          // Primary: y0 (ascending), Secondary: x0 (ascending)
          const dy = bboxes[a][1] - bboxes[b][1];
          if (dy !== 0) return dy;
          return bboxes[a][0] - bboxes[b][0];
        }
      });
      node.lineIdx = sorted;
    }
  } else {
    for (const child of node.children) {
      const [num, vNum] = sortNodes(child, bboxes);
      node.numLines += num;
      node.numVerticalLines += vNum;
    }
    if (node.isXSplit() && node.isVertical()) {
      node.children.reverse();
    }
  }
  return [node.numLines, node.numVerticalLines];
}

/**
 * Solve reading order using XY-Cut algorithm.
 * Returns ranks array where ranks[i] is the reading order of bbox i.
 */
export function solveXyCut(bboxes: number[][]): number[] {
  if (bboxes.length === 0) return [];

  const grid = getOptimalGrid(bboxes.length);
  const normalized = normalizeBboxes(bboxes, grid);
  const [table, tableW] = makeMeshTable(normalized);

  let xGrid = 0, yGrid = 0;
  for (const b of normalized) {
    if (b[2] + 1 > xGrid) xGrid = b[2] + 1;
    if (b[3] + 1 > yGrid) yGrid = b[3] + 1;
  }

  const root = new BlockNode(0, 0, xGrid, yGrid, null);
  blockXyCut(table, tableW, root);
  assignBboxToNode(root, normalized);
  sortNodes(root, normalized);

  const ranks = new Array<number>(bboxes.length).fill(-1);
  getRanking(root, ranks, 0);
  return ranks;
}
