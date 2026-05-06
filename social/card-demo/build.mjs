/**
 * Build card-demo short video.
 *
 * 1. Record intro/outro HTML as WebM via Playwright
 * 2. Convert to MP4
 * 3. Resize demo video to 1080x1920 (vertical, with background)
 * 4. Concatenate intro + demo + outro
 * 5. Merge with narration audio
 *
 * Usage: node social/card-demo/build.mjs
 * Requires: Playwright, ffmpeg
 */

import { createRequire } from "module";
import { mkdirSync, readdirSync, statSync, renameSync, existsSync, unlinkSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = resolve(__dirname, "tmp");
mkdirSync(tmpDir, { recursive: true });

const INTRO_DURATION = 4000;
const OUTRO_DURATION = 15000; // アウトロのアニメーション + ナレーション余裕

// ── Step 1: Record HTML scenes ──

async function recordHtml(htmlFile, outName, duration) {
  const require = createRequire("/usr/local/lib/node_modules/playwright/");
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    const require2 = createRequire("/opt/homebrew/lib/node_modules/playwright/");
    ({ chromium } = require2("playwright"));
  }

  const browser = await chromium.launch();
  const filePath = resolve(__dirname, htmlFile);
  const fileUrl = `file://${filePath}`;

  console.log(`  Recording ${htmlFile} (${duration / 1000}s)...`);

  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: tmpDir,
      size: { width: 1080, height: 1920 },
    },
  });

  const page = await context.newPage();
  await page.goto(fileUrl, { waitUntil: "load" });
  await page.waitForTimeout(duration);
  await context.close();

  // Rename latest webm
  const files = readdirSync(tmpDir).filter((f) => f.endsWith(".webm"));
  const latest = files
    .map((f) => ({ name: f, time: statSync(resolve(tmpDir, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time)[0];

  if (latest) {
    const dest = resolve(tmpDir, `${outName}.webm`);
    if (existsSync(dest)) unlinkSync(dest);
    renameSync(resolve(tmpDir, latest.name), dest);
    console.log(`    → ${outName}.webm`);
  }

  await browser.close();
}

// ── Step 2: Convert WebM → MP4 ──

function toMp4(name) {
  const input = resolve(tmpDir, `${name}.webm`);
  const output = resolve(tmpDir, `${name}.mp4`);
  console.log(`  Converting ${name}.webm → mp4...`);
  execSync(
    `ffmpeg -y -i "${input}" -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -an "${output}"`,
    { stdio: "pipe" }
  );
  console.log(`    → ${name}.mp4`);
}

// ── Step 3: Resize demo to 1080x1920 ──

function resizeDemo() {
  const input = resolve(__dirname, "card-demo.mov");
  const output = resolve(tmpDir, "demo-resized.mp4");
  console.log("  Resizing demo to 1080x1920...");
  // Speed up 1.2x, then pad to 1080x1920 with dark background, centered
  execSync(
    `ffmpeg -y -i "${input}" -vf "setpts=PTS/1.2,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#1a1a1a" -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -an "${output}"`,
    { stdio: "pipe" }
  );
  console.log("    → demo-resized.mp4");
}

// ── Step 4: Concatenate ──

function concatenate() {
  const listFile = resolve(tmpDir, "concat-list.txt");
  const lines = [
    `file '${resolve(tmpDir, "intro.mp4")}'`,
    `file '${resolve(tmpDir, "demo-resized.mp4")}'`,
    `file '${resolve(tmpDir, "outro.mp4")}'`,
  ];
  writeFileSync(listFile, lines.join("\n") + "\n");

  const output = resolve(tmpDir, "video-no-audio.mp4");
  console.log("  Concatenating intro + demo + outro...");
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p "${output}"`,
    { stdio: "pipe" }
  );

  // Get duration
  const dur = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${output}"`,
    { encoding: "utf8" }
  ).trim();
  console.log(`    → video-no-audio.mp4 (${parseFloat(dur).toFixed(1)}s)`);
}

// ── Step 5: Merge with narration ──

function mergeAudio() {
  const video = resolve(tmpDir, "video-no-audio.mp4");
  const audio = resolve(__dirname, "card-narration.wav");
  const output = resolve(__dirname, "card-demo-final.mp4");

  console.log("  Merging video + narration...");
  execSync(
    `ffmpeg -y -i "${video}" -i "${audio}" -c:v copy -c:a aac -b:a 192k -shortest "${output}"`,
    { stdio: "pipe" }
  );

  const dur = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${output}"`,
    { encoding: "utf8" }
  ).trim();
  console.log(`    → card-demo-final.mp4 (${parseFloat(dur).toFixed(1)}s)`);
}

// ── Main ──

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Card Demo — Short Video Builder    ║");
  console.log("╚══════════════════════════════════════╝\n");

  console.log("=== Step 1: Recording HTML scenes ===");
  await recordHtml("intro.html", "intro", INTRO_DURATION);
  await recordHtml("outro.html", "outro", OUTRO_DURATION);

  console.log("\n=== Step 2: Converting to MP4 ===");
  toMp4("intro");
  toMp4("outro");

  console.log("\n=== Step 3: Resizing demo ===");
  resizeDemo();

  console.log("\n=== Step 4: Concatenating ===");
  concatenate();

  console.log("\n=== Step 5: Merging audio ===");
  mergeAudio();

  console.log("\n✓ Done! → social/card-demo/card-demo-final.mp4");
}

main().catch((e) => { console.error(e); process.exit(1); });
