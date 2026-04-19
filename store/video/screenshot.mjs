/**
 * Capture store screenshots (1280x800) from screenshots.html
 * in both Japanese and English.
 *
 * Usage:
 *   node store/video/screenshot.mjs
 *
 * Output:
 *   store/video/screenshots/slide1-ja.png ... slide5-ja.png
 *   store/video/screenshots/slide1-en.png ... slide5-en.png
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

const htmlPath = resolve(__dirname, "..", "screenshots.html");
const fileUrl = `file://${htmlPath}`;

const SLIDE_COUNT = 5;

async function captureAll() {
  const browser = await chromium.launch();

  for (const lang of ["ja", "en"]) {
    console.log(`\nCapturing ${lang.toUpperCase()} screenshots...`);

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(fileUrl, { waitUntil: "networkidle" });

    // Hide the top bar (language toggle + GitHub link)
    await page.evaluate(() => {
      const topBar = document.querySelector(".top-bar");
      if (topBar) topBar.style.display = "none";
    });

    // Switch language
    if (lang === "en") {
      await page.evaluate(() => {
        document.body.classList.add("lang-en");
      });
      // Wait for reflow
      await page.waitForTimeout(300);
    }

    // Capture each slide
    for (let i = 1; i <= SLIDE_COUNT; i++) {
      // Find the i-th visible .slide element
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

  await browser.close();
  console.log(`\nDone! Screenshots saved to: ${outputDir}`);
}

captureAll().catch((e) => {
  console.error(e);
  process.exit(1);
});
