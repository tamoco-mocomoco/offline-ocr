/**
 * OCR の見本 (demo/docs.html の架空の文書) を画像と PDF にする。
 *
 *   node store/listing/make-demo.mjs
 *
 * 出力 (demo/out/): book.png (縦書きの頁)、book-photo.png (その頁を斜めに撮った写真)、
 * invoice.png (はんこと書き込みのある請求書)、report.pdf (3 頁の企画書)
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "demo/out");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1400 } });
await page.goto(`file://${resolve(HERE, "demo/docs.html")}`);
await page.evaluate(() => document.fonts.ready);

await page.locator("#book").screenshot({ path: resolve(OUT, "book.png") });
const book = readFileSync(resolve(OUT, "book.png")).toString("base64");
await page.evaluate((b64) => {
  document.getElementById("photo-page").innerHTML = `<img src="data:image/png;base64,${b64}" width="684" height="900" style="display:block">`;
}, book);
await page.waitForTimeout(200);
await page.locator("#photo").screenshot({ path: resolve(OUT, "book-photo.png") });
// 写真の中の頁の四隅 (ゆがみ補正で合わせる点)。頁に置いた小さな点の位置を測る
const corners = await page.evaluate(() => {
  const pg = document.getElementById("photo-page"), o = document.getElementById("photo").getBoundingClientRect();
  return [[0, 0], [684, 0], [684, 900], [0, 900]].map(([x, y]) => {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:0;height:0`;
    pg.appendChild(d);
    const r = d.getBoundingClientRect();
    d.remove();
    return [Math.round(r.left - o.left), Math.round(r.top - o.top)];
  });
});
writeFileSync(resolve(OUT, "book-photo-corners.json"), JSON.stringify(corners));
await page.locator("#invoice").screenshot({ path: resolve(OUT, "invoice.png") });
// 消しゴムで消すもの (はんこと書き込み) の位置。capture.mjs が使う
const boxes = await page.evaluate(() => {
  const o = document.getElementById("invoice").getBoundingClientRect();
  return Object.fromEntries([".stamp", ".memo", ".memo2"].map((q) => {
    const r = document.querySelector(`#invoice ${q}`).getBoundingClientRect();
    return [q.slice(1), [r.left - o.left, r.top - o.top, r.right - o.left, r.bottom - o.top].map(Math.round)];
  }));
});
writeFileSync(resolve(OUT, "invoice-erase.json"), JSON.stringify(boxes));

await page.evaluate(() => {
  for (const el of document.querySelectorAll(".doc")) el.remove();
});
await page.pdf({ path: resolve(OUT, "report.pdf"), width: "794px", height: "1123px", printBackground: true });
await browser.close();
console.log(OUT);
