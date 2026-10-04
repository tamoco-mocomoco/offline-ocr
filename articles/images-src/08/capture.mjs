// Render each HTML file in images-src/08/ with Playwright and save to
// articles/images/08-*.png. Run from repo root:
//   node articles/images-src/08/capture.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../images");

const SHOTS = [
  { html: "01-before-after.html", out: "08-01-before-after.png",   w: 1200, h: 600 },
  { html: "02-viewer-ui.html",     out: "08-02-viewer-ui.png",      w: 1400, h: 820 },
  { html: "03-pipeline.html",      out: "08-03-pipeline.png",       w: 1200, h: 720 },
  { html: "04-convexity.html",     out: "08-04-convexity.png",      w: 1100, h: 500 },
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
