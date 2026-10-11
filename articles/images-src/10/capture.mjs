// Render each HTML file in images-src/10/ with Playwright and save to
// articles/images/10-*.png. Run from repo root:
//   node articles/images-src/10/capture.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../images");

const SHOTS = [
  { html: "01-before-after.html", out: "10-01-before-after.png", w: 1200, h: 640 },
  { html: "02-viewer-ui.html",    out: "10-02-viewer-ui.png",    w: 1280, h: 900 },
  { html: "03-fill-color.html",   out: "10-03-fill-color.png",   w: 1200, h: 470 },
  { html: "04-overlay-bug.html",  out: "10-04-overlay-bug.png",  w: 1200, h: 520 },
];

const browser = await chromium.launch();
try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.w, height: shot.h },
      deviceScaleFactor: 1, // keep 1:1 — Retina scaling would double the PNG size
    });
    const page = await context.newPage();
    const url = "file://" + resolve(HERE, shot.html);
    await page.goto(url);
    // Give any web fonts / layout a tick to settle.
    await page.waitForTimeout(200);
    const outPath = resolve(OUT_DIR, shot.out);
    await page.screenshot({ path: outPath, type: "png", omitBackground: false });
    console.log(`→ ${shot.out} (${shot.w}×${shot.h})`);
    await context.close();
  }
} finally {
  await browser.close();
}
