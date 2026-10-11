// Render each HTML file in images-src/09/ with Playwright and save to
// articles/images/09-*.png. Run from repo root:
//   node articles/images-src/09/capture.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../images");

const SHOTS = [
  { html: "01-legacy-vs-modern.html", out: "09-01-legacy-vs-modern.png", w: 1200, h: 480 },
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
