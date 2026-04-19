/**
 * Capture store screenshots and promo tiles in both Japanese and English.
 *
 * Usage:
 *   node store/video/screenshot.mjs
 *
 * Output:
 *   store/video/screenshots/slide1-ja.png ... slide5-ja.png
 *   store/video/screenshots/slide1-en.png ... slide5-en.png
 *   store/video/screenshots/promo-small-ja.png  (440x280)
 *   store/video/screenshots/promo-small-en.png
 *   store/video/screenshots/promo-marquee-ja.png (1400x560)
 *   store/video/screenshots/promo-marquee-en.png
 */

import { createRequire } from "module";
const require = createRequire("/usr/local/lib/node_modules/playwright/");
const { chromium } = require("playwright");

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, "screenshots");
mkdirSync(outputDir, { recursive: true });

const SLIDE_COUNT = 5;

async function captureSlides(browser) {
  const htmlPath = resolve(__dirname, "..", "screenshots.html");
  const fileUrl = `file://${htmlPath}`;

  for (const lang of ["ja", "en"]) {
    console.log(`\nCapturing ${lang.toUpperCase()} slides...`);

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(fileUrl, { waitUntil: "networkidle" });

    // Hide the top bar and force fixed slide dimensions for screenshot
    await page.evaluate(() => {
      const topBar = document.querySelector(".top-bar");
      if (topBar) topBar.style.display = "none";
      document.querySelectorAll(".slide").forEach((s) => {
        s.style.width = "1280px";
        s.style.height = "800px";
        s.style.minHeight = "800px";
        s.style.maxWidth = "none";
      });
    });

    // Switch language
    if (lang === "en") {
      await page.evaluate(() => {
        document.body.classList.add("lang-en");
      });
      await page.waitForTimeout(300);
    }

    // Capture each slide
    for (let i = 1; i <= SLIDE_COUNT; i++) {
      const slideHandle = await page.evaluateHandle((idx) => {
        const slides = document.querySelectorAll(".slide");
        return slides[idx - 1];
      }, i);

      const outPath = resolve(outputDir, `slide${i}-${lang}.png`);
      await slideHandle.asElement().screenshot({ path: outPath });
      console.log(`  → slide${i}-${lang}.png`);
    }

    await context.close();
  }
}

async function captureTiles(browser) {
  const htmlPath = resolve(__dirname, "..", "promo-tiles.html");
  const fileUrl = `file://${htmlPath}`;

  const tiles = [
    { id: "tile-small",   name: "promo-small",   viewportW: 600,  viewportH: 400 },
    { id: "tile-marquee", name: "promo-marquee", viewportW: 1500, viewportH: 700 },
  ];

  for (const lang of ["ja", "en"]) {
    console.log(`\nCapturing ${lang.toUpperCase()} promo tiles...`);

    for (const tile of tiles) {
      const context = await browser.newContext({
        viewport: { width: tile.viewportW, height: tile.viewportH },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.goto(fileUrl, { waitUntil: "networkidle" });

      if (lang === "en") {
        await page.evaluate(() => {
          document.body.classList.add("lang-en");
        });
        await page.waitForTimeout(300);
      }

      const handle = await page.$(`#${tile.id}`);
      const outPath = resolve(outputDir, `${tile.name}-${lang}.png`);
      await handle.screenshot({ path: outPath });
      console.log(`  → ${tile.name}-${lang}.png`);

      await context.close();
    }
  }
}

async function main() {
  const browser = await chromium.launch();
  await captureSlides(browser);
  await captureTiles(browser);
  await browser.close();
  console.log(`\nDone! All screenshots saved to: ${outputDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
