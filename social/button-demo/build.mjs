/**
 * Build button-demo short video.
 *
 * 1. Record intro / scene / outro HTML as WebM via Playwright
 * 2. Convert to MP4
 * 3. Concatenate intro + scene + outro
 * 4. Merge with narration audio
 *
 * Usage: node social/button-demo/build.mjs
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
const SCENE_DURATION = 15000; // 2s drag-fail + 8s animation + 5s held result panel
const OUTRO_DURATION = 13000;
const FADE_DURATION = 0.8; // xfade duration in seconds between intro/scene/outro

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

// ── Step 3: Crossfade intro → scene → outro ──

function concatenate() {
  const intro = resolve(tmpDir, "intro.mp4");
  const scene = resolve(tmpDir, "scene.mp4");
  const outro = resolve(tmpDir, "outro.mp4");

  const introDur = INTRO_DURATION / 1000;
  const sceneDur = SCENE_DURATION / 1000;
  // xfade offset = when the next clip starts blending in (cumulative - fade)
  const offset1 = introDur - FADE_DURATION;
  const offset2 = introDur + sceneDur - 2 * FADE_DURATION;

  const filter =
    `[0:v][1:v]xfade=transition=fade:duration=${FADE_DURATION}:offset=${offset1}[v1];` +
    `[v1][2:v]xfade=transition=fade:duration=${FADE_DURATION}:offset=${offset2}[vout]`;

  const output = resolve(tmpDir, "video-no-audio.mp4");
  console.log(`  Crossfading intro + scene + outro (${FADE_DURATION}s fade)...`);
  execSync(
    `ffmpeg -y -i "${intro}" -i "${scene}" -i "${outro}" -filter_complex "${filter}" -map "[vout]" -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p "${output}"`,
    { stdio: "pipe" }
  );

  const dur = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${output}"`,
    { encoding: "utf8" }
  ).trim();
  console.log(`    → video-no-audio.mp4 (${parseFloat(dur).toFixed(1)}s)`);
}

// ── Step 4: Merge with narration ──

function mergeAudio() {
  const video = resolve(tmpDir, "video-no-audio.mp4");
  const audio = resolve(__dirname, "button-narration.wav");
  const output = resolve(__dirname, "button-demo-final.mp4");

  console.log("  Merging video + narration...");
  execSync(
    `ffmpeg -y -i "${video}" -i "${audio}" -c:v copy -c:a aac -b:a 192k -shortest "${output}"`,
    { stdio: "pipe" }
  );

  const dur = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${output}"`,
    { encoding: "utf8" }
  ).trim();
  console.log(`    → button-demo-final.mp4 (${parseFloat(dur).toFixed(1)}s)`);
}

// ── Main ──

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Button Demo — Short Video Builder  ║");
  console.log("╚══════════════════════════════════════╝\n");

  console.log("=== Step 1: Recording HTML scenes ===");
  await recordHtml("intro.html", "intro", INTRO_DURATION);
  await recordHtml("scene.html", "scene", SCENE_DURATION);
  await recordHtml("outro.html", "outro", OUTRO_DURATION);

  console.log("\n=== Step 2: Converting to MP4 ===");
  toMp4("intro");
  toMp4("scene");
  toMp4("outro");

  console.log("\n=== Step 3: Concatenating ===");
  concatenate();

  console.log("\n=== Step 4: Merging audio ===");
  mergeAudio();

  console.log("\n✓ Done! → social/button-demo/button-demo-final.mp4");
}

main().catch((e) => { console.error(e); process.exit(1); });
