// Capture the raw screenshots / OCR inputs used by the figures of article 10
// (viewer eraser, v0.9.1) by driving the real viewer page, and record the OCR
// result for each into raw/ocr-results.json. Run from repo root:
//
//   node articles/images-src/10/capture-raw.mjs
//
// The "before the fix" shots need the pre-v0.9.1 viewer. Check it out in a
// worktree and pass its path (node_modules can be a symlink to this repo's):
//
//   git worktree add --detach /tmp/wt-main b4c0a85
//   ln -s "$PWD/node_modules" /tmp/wt-main/node_modules
//   OLD_VIEWER_ROOT=/tmp/wt-main node articles/images-src/10/capture-raw.mjs
//
// The viewer runs from the Vite dev server with a stubbed `chrome` global
// (same approach as test/e2e/helpers/viewer.ts), so no extension build is
// needed. OCR runs in the E2E harness page with the real models.
import { chromium } from "playwright";
import { createServer } from "vite";
import sharp from "sharp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const RAW = resolve(HERE, "raw");
mkdirSync(RAW, { recursive: true });
const JA = JSON.parse(readFileSync(resolve(REPO, "public/_locales/ja/messages.json"), "utf8"));
const results = {};

async function startVite(root, port) {
  const server = await createServer({
    root,
    configFile: resolve(root, "vite.config.ts"),
    logLevel: "error",
    // A worktree that symlinks node_modules would otherwise share (and keep
    // re-optimizing) this repo's node_modules/.vite cache.
    cacheDir: root === REPO ? undefined : resolve(root, ".vite-capture-cache"),
    // node_modules may be a symlink outside `root` (worktree).
    server: { port, strictPort: true, fs: { strict: false } },
  });
  await server.listen();
  return { server, base: `http://localhost:${port}` };
}

const FONT = 'font-family="Hiragino Sans, sans-serif"';
const svgPng = (svg) => sharp(Buffer.from(svg)).png().toBuffer();

const INVOICE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <rect width="100%" height="100%" fill="#fbf8f0"/>
  <text x="80" y="130" font-size="56" ${FONT} fill="#222">請求書</text>
  <text x="80" y="220" font-size="34" ${FONT} fill="#222">株式会社サンプル 御中</text>
  <text x="80" y="320" font-size="34" ${FONT} fill="#222">品名：オフラインOCR ライセンス</text>
  <text x="80" y="390" font-size="34" ${FONT} fill="#222">金額：0円（無料）</text>
  <text x="80" y="460" font-size="34" ${FONT} fill="#222">発行日：2026年10月11日</text>
  <text x="640" y="600" font-size="30" ${FONT} fill="#222">オフラインOCR 開発室</text>
  <circle cx="1080" cy="590" r="70" fill="none" stroke="#d33" stroke-width="8"/>
  <text x="1080" y="606" font-size="44" ${FONT} fill="#d33" text-anchor="middle">承認</text>
</svg>`;

// Two lines on a dark page; the second gets erased.
const DARK = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400">
  <rect width="100%" height="100%" fill="#1e1e1e"/>
  <text x="100" y="140" font-size="64" ${FONT} fill="#e8e8e8">残しておく行</text>
  <text x="100" y="310" font-size="64" ${FONT} fill="#e8e8e8">消してしまう行</text>
</svg>`;
const DARK_STROKE = [[80, 255], [580, 255], [580, 285], [80, 285], [80, 315], [580, 315]];

const SMALL = (text, size) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400">
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="300" y="200" font-size="${size}" font-family="sans-serif" fill="#000">${text}</text>
</svg>`;

async function openViewer(context, base, png) {
  const page = await context.newPage();
  await page.addInitScript((m) => {
    const sent = [];
    window.__sent = sent;
    Object.defineProperty(window, "chrome", {
      configurable: true,
      writable: true,
      value: {
        i18n: { getMessage: (k) => m[k]?.message ?? "" },
        tabs: { getCurrent: async () => ({ id: 1 }) },
        runtime: { sendMessage: async (x) => { sent.push(x); }, getContexts: async () => [{}], onMessage: { addListener: () => {} } },
        offscreen: { createDocument: async () => {} },
        storage: { session: { get: async () => ({}), remove: async () => {} }, sync: { get: async () => ({}) }, local: { get: async () => ({}) } },
      },
    });
  }, JA);
  await page.goto(`${base}/src/viewer/viewer.html`);
  await page.setInputFiles("#file-input", { name: "image.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => !document.getElementById("btn-select").disabled, null, { timeout: 180_000 });
  return page;
}

// The stubbed chrome never answers run-ocr, so the "OCR running…" toast would
// stay up in every later screenshot.
async function shot(page, name) {
  await page.evaluate(() => document.getElementById("toast").classList.remove("show"));
  await page.waitForTimeout(500); // the toast fades out over 0.3s
  await page.screenshot({ path: resolve(RAW, name) });
}

async function toClient(page, x, y) {
  const box = await page.locator("#canvas").boundingBox();
  const { w, h } = await page.evaluate(() => {
    const c = document.getElementById("canvas");
    return { w: c.width, h: c.height };
  });
  return { x: box.x + (x * box.width) / w, y: box.y + (y * box.height) / h };
}

async function drag(page, points) {
  const p0 = await toClient(page, ...points[0]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (const pt of points.slice(1)) {
    const p = await toClient(page, ...pt);
    await page.mouse.move(p.x, p.y, { steps: 10 });
  }
  await page.mouse.up();
}

async function ocrInput(page, nth) {
  const h = await page.waitForFunction((n) => {
    const m = window.__sent.filter((x) => x?.type === "run-ocr")[n];
    return m ? m.screenshotDataUrl : null;
  }, nth);
  return Buffer.from((await h.jsonValue()).split(",")[1], "base64");
}

const server = await startVite(REPO, 5181);
const old = process.env.OLD_VIEWER_ROOT ? await startVite(process.env.OLD_VIEWER_ROOT, 5182) : null;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const harness = await context.newPage();
  await harness.goto(`${server.base}/test/e2e/harness/index.html`);
  await harness.waitForFunction(() => window.__ocr !== undefined, null, { timeout: 180_000 });
  await harness.evaluate(() => window.__ocr.whenReady());
  const ocr = async (png) =>
    (await harness.evaluate(async (b) => await window.__ocr.run(b), Array.from(png))).text;

  // ── Invoice with a stamp: before / while erasing / after ──
  {
    const page = await openViewer(context, server.base, await svgPng(INVOICE));
    await shot(page, "invoice-before.png");
    await page.click("#btn-ocr-all");
    results.invoiceBefore = await ocr(await ocrInput(page, 0));

    await page.click("#btn-erase");
    await page.click('.eraser-size[data-size="l"]');
    // Erase the upper half of the stamp, then pause with the cursor on it.
    await drag(page, [[995, 515], [1165, 515], [1165, 555], [995, 555], [995, 590], [1165, 590]]);
    const c = await toClient(page, 1080, 630);
    await page.mouse.move(c.x, c.y);
    await shot(page, "invoice-erasing.png");
    await drag(page, [[995, 610], [1165, 610], [1165, 645], [995, 645], [995, 670], [1165, 670]]);
    // Leave eraser mode so the toolbar (and the canvas position) match "before".
    await page.keyboard.press("Escape");
    await page.mouse.move(5, 5);
    await shot(page, "invoice-after.png");
    await page.click("#btn-ocr-all");
    results.invoiceAfter = await ocr(await ocrInput(page, 1));
    await page.close();
  }

  // ── Fill color on a dark page: surrounding color (eraser) vs plain white ──
  {
    const darkPng = await svgPng(DARK);
    const page = await openViewer(context, server.base, darkPng);
    await page.click("#btn-erase");
    await page.click('.eraser-size[data-size="l"]');
    const radius = await page.evaluate(() => {
      const c = document.getElementById("canvas");
      return 28 * (c.width / c.getBoundingClientRect().width);
    });
    await drag(page, DARK_STROKE);
    await page.click("#btn-ocr-all");
    const surrounding = await ocrInput(page, 0);
    await sharp(surrounding).toFile(resolve(RAW, "fill-surrounding.png"));
    results.fillSurrounding = await ocr(surrounding);
    await page.close();

    // Same stroke painted in white, then run through the viewer unchanged.
    const pts = DARK_STROKE.map(([x, y]) => `${x},${y}`).join(" ");
    const white = await sharp(darkPng)
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><polyline points="${pts}" fill="none" stroke="#fff" stroke-width="${radius * 2}" stroke-linecap="round" stroke-linejoin="round"/></svg>`) }])
      .png()
      .toBuffer();
    const p2 = await openViewer(context, server.base, white);
    await p2.click("#btn-ocr-all");
    const whiteInput = await ocrInput(p2, 0);
    await sharp(whiteInput).toFile(resolve(RAW, "fill-white.png"));
    results.fillWhite = await ocr(whiteInput);
    await p2.close();
  }

  // ── The selection-overlay bug: tight selection around small text ──
  // Only the OCR input images are saved here. The OCR results quoted in the
  // article come from the built extensions (offscreen path), not the harness.
  for (const [label, text, size] of [["settings", "Settings", 14], ["hash", "cfa8b33", 18]]) {
    const png = await svgPng(SMALL(text, size));
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
    let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (data[y * info.width + x] < 200) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
    const rect = [[x0 - 2, y0 - 2], [x1 + 2, y1 + 2]];
    for (const [when, srv] of [["old", old], ["new", server]]) {
      if (!srv) continue;
      const page = await openViewer(context, srv.base, png);
      await page.click("#btn-select");
      await drag(page, rect);
      const input = await ocrInput(page, 0);
      await sharp(input).toFile(resolve(RAW, `bug-${label}-${when}.png`));
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.server.close();
  if (old) await old.server.close();
}
writeFileSync(resolve(RAW, "ocr-results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
