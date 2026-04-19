/**
 * Port of src/reading_order/order/smooth_order.py
 *
 * Replaces networkx with simple adjacency list + recursive path enumeration.
 * This works because node count < 20 and max_step is 2-3.
 */

import type { Element } from "../parser/ndl-parser";

interface Edge {
  to: number;
  weight: number;
}

/**
 * Find minimum weight Hamiltonian path from node 0 to node numNodes-1
 * using DFS with pruning. Works for small graphs (< 20 nodes).
 */
function findMinHamiltonianPath(
  adj: Edge[][],
  numNodes: number,
): [number[] | null, number] {
  let minWeight = Infinity;
  let minPath: number[] | null = null;
  const visited = new Uint8Array(numNodes);

  function dfs(current: number, path: number[], weight: number): void {
    if (weight >= minWeight) return; // prune
    if (path.length === numNodes) {
      if (current === numNodes - 1 && weight < minWeight) {
        minWeight = weight;
        minPath = [...path];
      }
      return;
    }
    for (const edge of adj[current]) {
      if (!visited[edge.to]) {
        visited[edge.to] = 1;
        path.push(edge.to);
        dfs(edge.to, path, weight + edge.weight);
        path.pop();
        visited[edge.to] = 0;
      }
    }
  }

  visited[0] = 1;
  dfs(0, [0], 0);
  return [minPath, minWeight];
}

function smoothOrderPage(page: Element): void {
  const w = parseFloat(page.attrs.WIDTH);
  const h = parseFloat(page.attrs.HEIGHT);
  const diam = Math.sqrt(w * w + h * h);

  function traverse(parentEl: Element): void {
    const toBeSorted: [number, [number, number], [number, number], Element][] = [];
    const unsorted: Element[] = [];

    for (const element of parentEl.children) {
      if (element.tag === "TEXTBLOCK") {
        const orders: number[] = [];
        let isFirst = true;
        let begPos: [number, number] = [0, 0];
        let endPos: [number, number] = [0, 0];

        for (const child of element.children) {
          if (child.tag !== "LINE") continue;
          const order = parseFloat(child.attrs.ORDER ?? "NaN");
          orders.push(order);
          const x = parseFloat(child.attrs.X ?? "NaN");
          const y = parseFloat(child.attrs.Y ?? "NaN");
          const lw = parseFloat(child.attrs.WIDTH ?? "NaN");
          const lh = parseFloat(child.attrs.HEIGHT ?? "NaN");
          if (isFirst) {
            begPos = [x + lw / 2, y];
            isFirst = false;
          }
          endPos = [x + lw / 2, y + lh];
        }
        if (orders.length === 0) continue;
        const order = orders[Math.floor(orders.length / 2)];
        toBeSorted.push([order, begPos, endPos, element]);
      } else if (element.tag === "LINE") {
        const order = parseFloat(element.attrs.ORDER ?? "NaN");
        const x = parseFloat(element.attrs.X ?? "NaN");
        const y = parseFloat(element.attrs.Y ?? "NaN");
        const lw = parseFloat(element.attrs.WIDTH ?? "NaN");
        const lh = parseFloat(element.attrs.HEIGHT ?? "NaN");
        const begPos: [number, number] = [x + lw / 2, y];
        const endPos: [number, number] = [x + lw / 2, y + lh];
        toBeSorted.push([order, begPos, endPos, element]);
      } else if (element.tag === "BLOCK") {
        traverse(element);
        unsorted.push(element);
      } else {
        unsorted.push(element);
      }
    }

    const num = toBeSorted.length;
    if (num <= 0) return;

    const orders = toBeSorted.map((t) => t[0]);
    const orderRange = Math.max(...orders) - Math.min(...orders);
    if (orderRange <= 0) return;

    function calcWeight(i: number, j: number): number {
      const [orderI, , end] = toBeSorted[i];
      const [orderJ, beg] = toBeSorted[j];
      const orderD = Math.abs(orderI - orderJ) / orderRange;
      const dx = beg[0] - end[0];
      const dy = beg[1] - end[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist / diam + orderD;
    }

    // Build adjacency list
    const adj: Edge[][] = Array.from({ length: num }, () => []);
    const maxStep = num < 20 ? 3 : 2;
    for (let step = 1; step < maxStep; step++) {
      for (let i = 0; i < num - step; i++) {
        adj[i].push({ to: i + step, weight: calcWeight(i, i + step) });
        adj[i + step].push({ to: i, weight: calcWeight(i + step, i) });
      }
    }

    const [minPath] = findMinHamiltonianPath(adj, num);
    if (minPath) {
      parentEl.children = [
        ...minPath.map((i) => toBeSorted[i][3]),
        ...unsorted,
      ];
    }
  }

  traverse(page);
}

export function smoothOrder(root: Element): void {
  if (root.tag === "PAGE") {
    smoothOrderPage(root);
  } else {
    for (const child of root.children) {
      if (child.tag === "PAGE") {
        smoothOrderPage(child);
      }
    }
  }
}
