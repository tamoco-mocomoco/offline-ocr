/**
 * Record each scene HTML as a WebM video using Playwright.
 *
 * Usage:
 *   npx playwright test --config=none record.mjs
 *   — or simply —
 *   node record.mjs
 */

import { createRequire } from "module";
const require = createRequire("/usr/local/lib/node_modules/playwright/");
const { chromium } = require("playwright");
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const scenes = [
  { file: "scene0-title.html", duration: 8_000 },
  { file: "scene1-demo.html", duration: 24_000 },
  { file: "scene2-features.html", duration: 25_000 },
  { file: "scene3-privacy.html", duration: 22_000 },
  { file: "scene4-cleaning.html", duration: 20_000 },
  { file: "scene5-architecture.html", duration: 22_000 },
];

const outputDir = resolve(__dirname, "recordings");

async function main() {
  const browser = await chromium.launch();

  for (const scene of scenes) {
    const filePath = resolve(__dirname, scene.file);
    const fileUrl = `file://${filePath}`;
    const outName = scene.file.replace(".html", "");

    console.log(`Recording ${scene.file} (${scene.duration / 1000}s)...`);

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: {
        dir: outputDir,
        size: { width: 1920, height: 1080 },
      },
    });

    const page = await context.newPage();
    await page.goto(fileUrl, { waitUntil: "load" });

    // Wait for animation to complete
    await page.waitForTimeout(scene.duration);

    // Close context to finalize video
    await context.close();

    // Rename the video file
    const fs = await import("fs");
    const files = fs.readdirSync(outputDir).filter((f) => f.endsWith(".webm"));
    // The most recently created file
    const latest = files
      .map((f) => ({
        name: f,
        time: fs.statSync(resolve(outputDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time)[0];

    if (latest) {
      const dest = resolve(outputDir, `${outName}.webm`);
      fs.renameSync(resolve(outputDir, latest.name), dest);
      console.log(`  → ${dest}`);
    }
  }

  await browser.close();
  console.log("\nDone! Videos saved to:", outputDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
