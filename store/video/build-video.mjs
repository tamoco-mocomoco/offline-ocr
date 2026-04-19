/**
 * Build promotional video assets in one step.
 *
 * 1. Record each scene HTML as WebM using Playwright
 * 2. Convert WebM → MP4 using ffmpeg
 * 3. Generate narration WAV using VOICEVOX API
 * 4. Combine all narration clips into a single timed WAV
 *
 * Prerequisites:
 *   - Playwright installed (npm install -g playwright)
 *   - ffmpeg installed (brew install ffmpeg)
 *   - VOICEVOX app running (localhost:50021)
 *
 * Usage:
 *   node store/video/build-video.mjs              # Run all steps
 *   node store/video/build-video.mjs --video-only # Skip voice generation
 *   node store/video/build-video.mjs --voice-only # Skip video recording
 */

import { createRequire } from "module";
import { writeFileSync, readFileSync, mkdirSync, readdirSync, statSync, renameSync, existsSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

const scenes = [
  { file: "scene0-title.html", duration: 11_000 },
  { file: "scene1-demo.html", duration: 36_000 },
  { file: "scene2-features.html", duration: 42_000 },
  { file: "scene3-privacy.html", duration: 38_000 },
  { file: "scene4-cleaning.html", duration: 39_000 },
  { file: "scene5-architecture.html", duration: 42_000 },
];

const VOICEVOX_URL = "http://localhost:50021";
const SPEAKER_ID = 68; // あいえるたん

// Timing rule: element appears → 0.5s pause → narration starts → narration ends → 2s gap → next element
// Scene transitions: 3s gap
const narrations = [
  // Scene 0: タイトル (0s〜)
  { start: 1.5,   file: "scene0-01", text: "オフラインOCR。どこにも通信しない、安全な範囲選択OCRです。" },         // 6.3s → end 7.8 → +3s

  // Scene 1: 操作デモ (10.8s〜, 相対時間で記載)
  { start: 11.3,  file: "scene1-01", text: "使い方はとてもシンプルです。" },                                       // 2.2s → 13.5 → +2s
  { start: 16.0,  file: "scene1-02", text: "OCRしたい箇所をマウスでドラッグするだけ。" },                           // 3.3s → 19.3 → +2s
  { start: 21.8,  file: "scene1-03", text: "国立国会図書館のOCR技術が、ブラウザの中だけで文字を認識します。" },       // 6.0s → 27.8 → +2s
  { start: 30.3,  file: "scene1-04", text: "認識結果は自動でクリップボードにコピー。そのままペーストできます。" },     // 4.9s → 35.2 → +2s
  { start: 37.7,  file: "scene1-05", text: "完全オフライン。日本語に特化。縦書きにも対応。ワンクリックで起動できます。" }, // 6.3s → 44.0 → +3s

  // Scene 2: 特徴一覧 (47.0s〜)
  { start: 47.5,  file: "scene2-01", text: "主な特徴をご紹介します。" },                                           // 2.3s → 49.8 → +2s
  { start: 52.3,  file: "scene2-02", text: "すべての処理がブラウザ内で完結。外部への通信は一切ありません。国立国会図書館が開発した高精度エンジンを搭載しています。" }, // 10.2s → 62.5 → +2.5s
  { start: 65.5,  file: "scene2-03", text: "横書きだけでなく、古い書籍の縦書きテキストにも対応。ツールバー、ショートカット、右クリックメニューの3通りで起動できます。" }, // 9.3s → 74.8 → +2.5s
  { start: 77.8,  file: "scene2-04", text: "正規表現でOCR結果を自動整形するクリーニング機能。UIは日本語と英語を自動で切り替えます。" }, // 8.1s → 85.9 → +3s

  // Scene 3: プライバシー (88.9s〜)
  { start: 89.4,  file: "scene3-01", text: "プライバシーについて。このアプリはあなたのデータを一切外部に送りません。" }, // 5.3s → 94.7 → +2s
  { start: 97.2,  file: "scene3-02", text: "画像のキャプチャ、OCRエンジン、AIモデル、認識結果。すべてがあなたのブラウザの中だけで動作します。" }, // 8.3s → 105.5 → +2s
  { start: 108.0, file: "scene3-03", text: "外部サーバーとの通信は完全にブロック。画像もテキストも送信されません。" }, // 5.6s → 113.6 → +2s
  { start: 116.1, file: "scene3-04", text: "ネットワークリクエストはゼロ。データ収集もゼロ。インターネットに接続していなくても、そのまま使えます。" }, // 7.9s → 124.0 → +3s

  // Scene 4: クリーニング (127.0s〜)
  { start: 127.5, file: "scene4-01", text: "クリーニングルール機能をご紹介します。" },                             // 2.7s → 130.2 → +2s
  { start: 132.7, file: "scene4-02", text: "OCRの結果を、コピーする前に正規表現で自動整形できます。スペースの除去、カンマの削除、改行の整理。ルールは自由に追加・並べ替え可能です。" }, // 12.9s → 145.6 → +2s
  { start: 148.1, file: "scene4-03", text: "たとえば、請求書の金額。OCRの生データにはカンマやスペースが含まれていますが、" }, // 6.8s → 154.9 → +2s
  { start: 157.4, file: "scene4-04", text: "ルールを適用すると、不要な文字が除去され、きれいな数値に整形されます。" }, // 5.6s → 163.0 → +3s

  // Scene 5: アーキテクチャ (166.0s〜)
  { start: 166.5, file: "scene5-01", text: "技術的な仕組みをご説明します。" },                                     // 2.5s → 169.0 → +2s
  { start: 171.5, file: "scene5-02", text: "コンテントスクリプトがページ上で範囲選択UIを表示し、座標をサービスワーカーに送ります。" }, // 7.0s → 178.5 → +2s
  { start: 181.0, file: "scene5-03", text: "サービスワーカーがスクリーンショットを取得し、OCRワーカーに転送。" },     // 5.2s → 186.2 → +2s
  { start: 188.7, file: "scene5-04", text: "ONNX Runtime Webでローカル推論を実行します。" },                       // 4.3s → 193.0 → +2s
  { start: 195.5, file: "scene5-05", text: "認識結果がコンテントスクリプトに返され、クリップボードに書き込まれます。すべてマニフェストV3ベースで、安全にローカル完結しています。" }, // 9.9s → 205.4
];

const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const TOTAL_DURATION = 210;

// ── Directories ─────────────────────────────────────────────────────────────

const recordingsDir = resolve(__dirname, "recordings");
const voiceDir = resolve(__dirname, "voice");

// ── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const videoOnly = args.includes("--video-only");
const voiceOnly = args.includes("--voice-only");

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function wavToPcm(wavBuf) {
  return wavBuf.subarray(44);
}

function buildWavHeader(pcmLength) {
  const header = Buffer.alloc(44);
  const numChannels = 1;
  const byteRate = SAMPLE_RATE * numChannels * BYTES_PER_SAMPLE;
  const blockAlign = numChannels * BYTES_PER_SAMPLE;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmLength, 40);
  return header;
}

// ── Step 1: Record videos ───────────────────────────────────────────────────

async function recordVideos() {
  console.log("\n========================================");
  console.log(" Step 1: Recording scene videos (WebM)");
  console.log("========================================\n");

  mkdirSync(recordingsDir, { recursive: true });

  const require = createRequire("/usr/local/lib/node_modules/playwright/");
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    // Try global npm path for Apple Silicon
    const require2 = createRequire("/opt/homebrew/lib/node_modules/playwright/");
    ({ chromium } = require2("playwright"));
  }

  const browser = await chromium.launch();

  for (const scene of scenes) {
    const filePath = resolve(__dirname, scene.file);
    const fileUrl = `file://${filePath}`;
    const outName = scene.file.replace(".html", "");

    console.log(`  Recording ${scene.file} (${scene.duration / 1000}s)...`);

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: {
        dir: recordingsDir,
        size: { width: 1920, height: 1080 },
      },
    });

    const page = await context.newPage();
    await page.goto(fileUrl, { waitUntil: "load" });
    await page.waitForTimeout(scene.duration);
    await context.close();

    // Rename the latest video file
    const files = readdirSync(recordingsDir).filter((f) => f.endsWith(".webm"));
    const latest = files
      .map((f) => ({
        name: f,
        time: statSync(resolve(recordingsDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time)[0];

    if (latest) {
      const dest = resolve(recordingsDir, `${outName}.webm`);
      if (existsSync(dest)) unlinkSync(dest);
      renameSync(resolve(recordingsDir, latest.name), dest);
      console.log(`    → ${outName}.webm`);
    }
  }

  await browser.close();
}

// ── Step 2: Convert WebM → MP4 ─────────────────────────────────────────────

function convertToMp4() {
  console.log("\n========================================");
  console.log(" Step 2: Converting WebM → MP4");
  console.log("========================================\n");

  const webmFiles = readdirSync(recordingsDir).filter(
    (f) => f.endsWith(".webm") && f.startsWith("scene")
  );

  for (const webm of webmFiles) {
    const input = resolve(recordingsDir, webm);
    const output = resolve(recordingsDir, webm.replace(".webm", ".mp4"));
    console.log(`  Converting ${webm}...`);
    execSync(
      `ffmpeg -y -i "${input}" -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -an "${output}"`,
      { stdio: "pipe" }
    );
    console.log(`    → ${webm.replace(".webm", ".mp4")}`);
  }

  // Also create a concatenated full video
  console.log("\n  Concatenating all scenes...");
  const listFile = resolve(recordingsDir, "concat-list.txt");
  const mp4Files = scenes.map((s) =>
    `file '${resolve(recordingsDir, s.file.replace(".html", ".mp4"))}'`
  );
  writeFileSync(listFile, mp4Files.join("\n") + "\n");

  const fullMp4 = resolve(recordingsDir, "full-video.mp4");
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${fullMp4}"`,
    { stdio: "pipe" }
  );
  console.log(`    → full-video.mp4`);
}

// ── Step 3: Generate voice ──────────────────────────────────────────────────

async function generateVoice() {
  console.log("\n========================================");
  console.log(" Step 3: Generating narration (VOICEVOX)");
  console.log("========================================\n");

  mkdirSync(voiceDir, { recursive: true });

  // Check VOICEVOX
  try {
    const res = await fetch(`${VOICEVOX_URL}/version`);
    const version = await res.text();
    console.log(`  VOICEVOX version: ${version}`);
  } catch {
    console.error("  ✕ VOICEVOX is not running. Skipping voice generation.");
    console.error("    Start VOICEVOX app and re-run with: node build-video.mjs --voice-only");
    return;
  }

  console.log(`  Speaker: あいえるたん (ID: ${SPEAKER_ID})\n`);

  const clips = [];

  for (const item of narrations) {
    process.stdout.write(`  Generating ${item.file}...`);

    // audio_query
    const queryRes = await fetch(
      `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(item.text)}&speaker=${SPEAKER_ID}`,
      { method: "POST" }
    );
    const query = await queryRes.json();

    // synthesis
    const synthRes = await fetch(
      `${VOICEVOX_URL}/synthesis?speaker=${SPEAKER_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      }
    );
    const wav = Buffer.from(await synthRes.arrayBuffer());

    // Save individual clip
    const outPath = resolve(voiceDir, `${item.file}.wav`);
    writeFileSync(outPath, wav);

    const pcm = wavToPcm(wav);
    const duration = pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE);
    clips.push({ ...item, pcm, duration });
    console.log(` done (${duration.toFixed(1)}s)`);
  }

  // Build combined WAV
  console.log("\n  Building combined narration...");
  const totalSamples = SAMPLE_RATE * TOTAL_DURATION;
  const combinedPcm = Buffer.alloc(totalSamples * BYTES_PER_SAMPLE, 0);
  const timestamps = [];

  for (const clip of clips) {
    const offsetBytes = Math.round(clip.start * SAMPLE_RATE) * BYTES_PER_SAMPLE;
    const maxCopy = Math.min(clip.pcm.length, combinedPcm.length - offsetBytes);
    if (maxCopy > 0) {
      clip.pcm.copy(combinedPcm, offsetBytes, 0, maxCopy);
    }
    timestamps.push(
      `${formatTime(clip.start)} - ${formatTime(clip.start + clip.duration)}  ${clip.file}  "${clip.text}"`
    );
  }

  const header = buildWavHeader(combinedPcm.length);
  const fullWav = Buffer.concat([header, combinedPcm]);
  writeFileSync(resolve(voiceDir, "narration-full.wav"), fullWav);
  writeFileSync(resolve(voiceDir, "timestamps.txt"), timestamps.join("\n") + "\n");
  console.log(`    → narration-full.wav (${TOTAL_DURATION}s)`);
  console.log(`    → timestamps.txt`);

  // Convert to MP4-compatible audio (AAC)
  console.log("\n  Converting narration to AAC...");
  execSync(
    `ffmpeg -y -i "${resolve(voiceDir, "narration-full.wav")}" -c:a aac -b:a 192k "${resolve(voiceDir, "narration-full.m4a")}"`,
    { stdio: "pipe" }
  );
  console.log(`    → narration-full.m4a`);
}

// ── Step 4: Merge video + audio ─────────────────────────────────────────────

function mergeVideoAudio() {
  const videoPath = resolve(recordingsDir, "full-video.mp4");
  const audioPath = resolve(voiceDir, "narration-full.m4a");
  const outputPath = resolve(__dirname, "promo-video.mp4");

  if (!existsSync(videoPath)) {
    console.log("\n  ⚠ full-video.mp4 not found. Skipping merge.");
    return;
  }
  if (!existsSync(audioPath)) {
    console.log("\n  ⚠ narration-full.m4a not found. Skipping merge.");
    return;
  }

  console.log("\n========================================");
  console.log(" Step 4: Merging video + narration");
  console.log("========================================\n");

  execSync(
    `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outputPath}"`,
    { stdio: "pipe" }
  );
  console.log(`  → promo-video.mp4\n`);
  console.log("Done! Final video: store/video/promo-video.mp4");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Offline OCR — Video Builder        ║");
  console.log("╚══════════════════════════════════════╝");

  if (!voiceOnly) {
    await recordVideos();
    convertToMp4();
  }

  if (!videoOnly) {
    await generateVoice();
  }

  if (!voiceOnly && !videoOnly) {
    mergeVideoAudio();
  }

  console.log("\n✓ All tasks complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
