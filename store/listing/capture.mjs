/**
 * ストアの画面写真と動画に使う、拡張の本物の画面を撮る。
 * dist/ の拡張を Playwright の Chromium に読み込み、demo/out/ の見本を実際に OCR する。
 *
 *   npm run build && node store/listing/make-demo.mjs
 *   node store/listing/capture.mjs [--lang en] [--video]
 *
 * 出力: shots/<lang>/*.png (1280×800 の画面)。
 * --video のときは、流れごとの録画 clips/<lang>/<流れ>.webm と、操作した時刻 clips/<lang>/<流れ>.json も残す
 * (動画の台本の合図に、操作の時刻を合わせるため)。録画にはマウスが写らないので、矢印を描いて重ねる
 */
import { chromium } from "playwright";
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DEMO = resolve(HERE, "demo");
const argv = process.argv.slice(2);
const LANG = argv.includes("--lang") ? argv[argv.indexOf("--lang") + 1] : "ja";
const VIDEO = argv.includes("--video");
const SHOTS = resolve(HERE, "shots", LANG);
const CLIPS = resolve(HERE, "clips", LANG);
mkdirSync(SHOTS, { recursive: true });
const VIEW = { width: 1280, height: 800 };
// Mac の Chromium は --lang を見ず、拡張の言葉は OS の言語で決まる。英語の画面は、ja の訳を抜いた dist の写しで撮る
// (訳が無いと default_locale の en になる)
let DIST = resolve(ROOT, "dist");
if (LANG !== "ja") {
  const copy = resolve(HERE, ".dist-en");
  rmSync(copy, { recursive: true, force: true });
  cpSync(DIST, copy, { recursive: true });
  rmSync(resolve(copy, "_locales/ja"), { recursive: true, force: true });
  DIST = copy;
}

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: true,
  locale: LANG === "ja" ? "ja-JP" : "en-US",
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, `--lang=${LANG}`],
  viewport: VIEW,
  permissions: ["clipboard-read", "clipboard-write"],
  ...(VIDEO ? { recordVideo: { dir: resolve(CLIPS, "raw"), size: VIEW } } : {}),
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const EXT = `chrome-extension://${new URL(sw.url()).host}`;
// 結果のダイアログは画面写真に写らないので、トーストだけにする
await sw.evaluate(() => chrome.storage.sync.set({ settings: { showResultAlert: false } }));

if (VIDEO) {
  // 録画に写る矢印のマウス (操作には関わらない)
  await ctx.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const c = document.createElement("div");
      c.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 17 L20 17 Z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>';
      c.style.cssText = "position:fixed;left:-40px;top:-40px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))";
      document.documentElement.appendChild(c);
      addEventListener("mousemove", (e) => { c.style.left = `${e.clientX - 2}px`; c.style.top = `${e.clientY - 2}px`; }, true);
    });
  });
}

// 見本のブログを https://blog.example.jp/ として配る (拡張は <all_urls> で動く)
await ctx.route("https://blog.example.jp/**", (route) => {
  const name = new URL(route.request().url()).pathname.split("/").pop() || "article.html";
  const file = name === "book.png" ? resolve(DEMO, "out/book.png") : resolve(DEMO, name);
  route.fulfill({ body: readFileSync(file), contentType: name.endsWith(".png") ? "image/png" : "text/html; charset=utf-8" });
});

/** トーストに「コピーしました」が出るまで待つ (出なければ、そのときのトーストを見せて止める) */
async function copied(page, sel) {
  try {
    await page.locator(sel).filter({ hasText: /コピー|Copied/ }).waitFor({ timeout: 120_000 });
  } catch (e) {
    await page.screenshot({ path: resolve(SHOTS, "_failed.png") });
    throw new Error(`no copy toast: ${await page.locator(sel).allInnerTexts()}`);
  }
}
// 録画のときはマウスの矢印が写るので、画面写真は撮らない
const shot = (page, name) => (VIDEO ? null : page.screenshot({ path: resolve(SHOTS, `${name}.png`) }));
/** 待つ。録画のときは、見ている人が追えるように長めに待つ */
const wait = (page, ms, videoMs = ms) => page.waitForTimeout(VIDEO ? videoMs : ms);

/** 流れを 1 つ始める。mark(名前) で操作の時刻 (録画の始まりからの秒) を残す */
async function flow(name, body) {
  const page = await ctx.newPage();
  const t0 = Date.now();
  const marks = {};
  const mark = (k) => { marks[k] = +((Date.now() - t0) / 1000).toFixed(2); };
  await body(page, mark);
  const video = page.video();
  marks.end = +((Date.now() - t0) / 1000).toFixed(2);
  await page.close();
  if (video) {
    mkdirSync(CLIPS, { recursive: true });
    renameSync(await video.path(), resolve(CLIPS, `${name}.webm`));
    writeFileSync(resolve(CLIPS, `${name}.json`), JSON.stringify(marks, null, 2));
  }
  console.log(name, JSON.stringify(marks));
}

/** なめらかなドラッグ (動画で見えるように少しずつ動かす) */
async function drag(page, from, to, steps = 30) {
  await page.mouse.move(from.x, from.y, { steps: VIDEO ? 12 : 1 });
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** ビューアの画像座標 → 画面の座標 */
async function mapper(page) {
  const c = await page.locator("#canvas").boundingBox();
  const k = c.width / (await page.evaluate(() => document.getElementById("canvas").width));
  return (x, y) => ({ x: c.x + x * k, y: c.y + y * k });
}

/** ビューアに見本を開く */
async function openViewer(page, file, ready) {
  await page.goto(`${EXT}/viewer.html`);
  await page.mouse.move(640, 760);
  await page.setInputFiles("#file-input", resolve(DEMO, "out", file));
  await page.locator(ready).waitFor({ state: "visible" });
}

const clipText = (page) => page.evaluate(() => navigator.clipboard.readText());

// ── 1. ページの上で範囲選択 ──
await flow("page", async (page, mark) => {
  await page.goto("https://blog.example.jp/kosho/article.html");
  await page.mouse.move(700, 520);
  await wait(page, 800, 1500);
  mark("loaded");
  const img = await page.locator("figure img").boundingBox();
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
  await sw.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(id, { target: "content", type: "start-selection" });
  }, tabId);
  await wait(page, 700, 1500);
  mark("started");
  await shot(page, "page-start");
  const a = { x: img.x + 10, y: img.y + 12 }, b = { x: img.x + img.width - 10, y: img.y + img.height - 36 };
  await page.mouse.move(a.x, a.y, { steps: VIDEO ? 20 : 1 });
  await wait(page, 0, 400);
  mark("drag");
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2 + 40, (a.y + b.y) / 2 + 60, { steps: VIDEO ? 40 : 25 });
  await shot(page, "page-drag");
  await page.mouse.move(b.x, b.y, { steps: VIDEO ? 30 : 15 });
  await wait(page, 300, 600);
  await shot(page, "page-select");
  await page.mouse.up();
  mark("released");
  await copied(page, '[data-ndlocr-lite="toast"]');
  mark("copied");
  await wait(page, 200);
  await shot(page, "page-copied");
  console.log("page:", await clipText(page));
  await wait(page, 2500, 3000);
});

// ── 2. ビューアの消しゴム ──
await flow("erase", async (page, mark) => {
  await openViewer(page, "invoice.png", "#btn-erase");
  await wait(page, 800, 1500);
  mark("loaded");
  await shot(page, "erase-before");
  await page.click("#btn-erase");
  await page.click('.eraser-size[data-size="m"]');
  await wait(page, 0, 800);
  mark("eraser");
  const at = await mapper(page);
  const boxes = JSON.parse(readFileSync(resolve(DEMO, "out/invoice-erase.json"), "utf8"));
  /** 箱をジグザグに塗る */
  async function paint([x0, y0, x1, y1]) {
    for (let y = y0 + 16; y <= y1 - 6; y += 24) await drag(page, at(x0 - 6, y), at(x1 + 6, y), VIDEO ? 16 : 12);
  }
  const [x0, y0, x1, y1] = boxes.stamp;
  await paint([x0, y0, x1, (y0 + y1) / 2]);
  await page.mouse.move(at(x1 - 30, (y0 + y1) / 2).x, at(x1 - 30, (y0 + y1) / 2).y);
  await shot(page, "erase-mid");
  await paint(boxes.stamp);
  mark("stamp");
  await shot(page, "erase-stamp");
  await paint(boxes.memo);
  await paint(boxes.memo2);
  mark("erased");
  await wait(page, 300, 1200);
  await shot(page, "erase-after");
  await page.click("#btn-erase");
  await page.hover("#btn-ocr-all");
  await wait(page, 0, 600);
  await page.click("#btn-ocr-all");
  mark("ocr");
  await copied(page, "#toast");
  mark("copied");
  await wait(page, 200);
  await shot(page, "erase-copied");
  console.log("erase:", await clipText(page));
  await wait(page, 2000, 3000);
});

// ── 3. ゆがみ補正で選択 ──
await flow("quad", async (page, mark) => {
  await openViewer(page, "book-photo.png", "#btn-quad-select");
  await wait(page, 800, 1500);
  mark("loaded");
  await shot(page, "quad-before");
  await page.hover("#btn-quad-select");
  await wait(page, 0, 500);
  await page.click("#btn-quad-select");
  await wait(page, 500, 1000);
  mark("quad");
  const at = await mapper(page);
  const [w, h] = [1200, 1100], m = 0.1;
  const init = [[w * m, h * m], [w * (1 - m), h * m], [w * (1 - m), h * (1 - m)], [w * m, h * (1 - m)]];
  const corners = JSON.parse(readFileSync(resolve(DEMO, "out/book-photo-corners.json"), "utf8"));
  for (let i = 0; i < 4; i++) {
    await drag(page, at(...init[i]), at(...corners[i]), VIDEO ? 30 : 20);
    await wait(page, 250, 500);
  }
  mark("fitted");
  await wait(page, 500, 1500);
  await shot(page, "quad-fit");
  await page.hover("#btn-quad-confirm");
  await wait(page, 0, 500);
  await page.click("#btn-quad-confirm");
  mark("ocr");
  await copied(page, "#toast");
  mark("copied");
  await wait(page, 200);
  await shot(page, "quad-copied");
  console.log("quad:", await clipText(page));
  await wait(page, 2000, 3000);
});

// ── 4. PDF ──
await flow("pdf", async (page, mark) => {
  await openViewer(page, "report.pdf", "#pdf-nav");
  await wait(page, 1200, 1500);
  mark("loaded");
  await shot(page, "pdf-page1");
  await page.hover("#btn-pdf-next");
  await wait(page, 0, 800);
  await page.click("#btn-pdf-next");
  await wait(page, 1200, 1500);
  mark("page2");
  await shot(page, "pdf-page2");
  await page.hover("#btn-select");
  await wait(page, 0, 500);
  await page.click("#btn-select");
  await wait(page, 400, 600);
  const at = await mapper(page);
  const cw = await page.evaluate(() => document.getElementById("canvas").width);
  const s = cw / 794; // 頁は 794×1123 (CSS px) で描いた
  mark("drag");
  await drag(page, at(70 * s, 80 * s), at(730 * s, 560 * s), VIDEO ? 45 : 30);
  mark("released");
  await copied(page, "#toast");
  mark("copied");
  await wait(page, 200);
  await shot(page, "pdf-copied");
  console.log("pdf:", await clipText(page));
  await wait(page, 2000, 3000);
});

// ── 5. 履歴 ──
await flow("history", async (page, mark) => {
  await page.goto(`${EXT}/history.html`);
  await page.mouse.move(700, 500);
  await wait(page, 1200, 1500);
  mark("loaded");
  await shot(page, "history");
  await page.hover("#search");
  await page.click("#search");
  mark("search");
  await page.keyboard.type("古本", { delay: VIDEO ? 250 : 0 });
  await wait(page, 1000, 1500);
  mark("found");
  await shot(page, "history-search");
  const copy = page.locator("#list button").first();
  await copy.hover();
  await wait(page, 0, 600);
  await copy.click();
  mark("copied");
  await wait(page, 600, 2500);
});

// ── 6. 設定とクリーニングルール ──
await flow("options", async (page, mark) => {
  await page.goto(`${EXT}/options.html`);
  await page.mouse.move(700, 400);
  await wait(page, 1000, 1500);
  mark("loaded");
  await shot(page, "options");
  await page.locator("#rules").scrollIntoViewIfNeeded();
  await wait(page, 500, 1200);
  mark("rules");
  await shot(page, "options-rules");
  // 「カンマを削除」を有効にして、その場で試す
  const comma = page.locator("#rules > *").nth(1).locator('input[type="checkbox"]');
  await comma.hover();
  await wait(page, 0, 600);
  await comma.check();
  mark("enabled");
  await page.locator("#test-input").scrollIntoViewIfNeeded();
  await wait(page, 300, 1000);
  await page.click("#test-input");
  mark("type");
  await page.keyboard.type("ご請求金額 ¥1,234,567", { delay: VIDEO ? 90 : 0 });
  await page.hover("#run-test");
  await wait(page, 200, 600);
  await page.click("#run-test");
  mark("tested");
  await wait(page, 500, 2500);
  await shot(page, "options-test");
});

// ── 7. ポップアップ (画面写真だけ) ──
{
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 300, height: 440 });
  await page.goto(`${EXT}/popup.html`);
  await wait(page, 600);
  await shot(page, "popup");
  await page.close();
}

await ctx.close();
if (VIDEO) rmSync(resolve(CLIPS, "raw"), { recursive: true, force: true });
console.log(SHOTS);
