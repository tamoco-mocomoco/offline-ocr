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
 *   node store/video/build-video.mjs                    # Build Japanese version (default)
 *   node store/video/build-video.mjs --lang en          # Build English version
 *   node store/video/build-video.mjs --video-only       # Skip voice generation
 *   node store/video/build-video.mjs --voice-only       # Skip video recording
 */

import { createRequire } from "module";
import { writeFileSync, readFileSync, mkdirSync, readdirSync, statSync, renameSync, existsSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const videoOnly = args.includes("--video-only");
const voiceOnly = args.includes("--voice-only");
const langIdx = args.indexOf("--lang");
const LANG = langIdx >= 0 && args[langIdx + 1] ? args[langIdx + 1] : "ja";

if (LANG !== "ja" && LANG !== "en") {
  console.error(`Unknown language: ${LANG}. Use "ja" or "en".`);
  process.exit(1);
}

// ── Config ──────────────────────────────────────────────────────────────────

const suffix = LANG === "en" ? "-en" : "";

const scenes = [
  { file: `scene0-title${suffix}.html`, duration: 11_000 },
  { file: `scene1-demo${suffix}.html`, duration: 36_000 },
  { file: `scene2-features${suffix}.html`, duration: 42_000 },
  { file: `scene3-privacy${suffix}.html`, duration: 38_000 },
  { file: `scene4-cleaning${suffix}.html`, duration: 39_000 },
  { file: `scene5-architecture${suffix}.html`, duration: 42_000 },
];

const VOICEVOX_URL = "http://localhost:50021";
const SPEAKER_ID = 68; // あいえるたん

// Timing rule: element appears → 0.5s pause → narration starts → narration ends → 2s gap → next element
// Scene transitions: 3s gap
const narrations_ja = [
  { start: 1.5,   file: "scene0-01", text: "オフラインOCR。どこにも通信しない、安全な範囲選択OCRです。" },
  { start: 11.3,  file: "scene1-01", text: "使い方はとてもシンプルです。" },
  { start: 16.0,  file: "scene1-02", text: "OCRしたい箇所をマウスでドラッグするだけ。" },
  { start: 21.8,  file: "scene1-03", text: "国立国会図書館のOCR技術が、ブラウザの中だけで文字を認識します。" },
  { start: 30.3,  file: "scene1-04", text: "認識結果は自動でクリップボードにコピー。そのままペーストできます。" },
  { start: 37.7,  file: "scene1-05", text: "完全オフライン。日本語に特化。縦書きにも対応。ワンクリックで起動できます。" },
  { start: 47.5,  file: "scene2-01", text: "主な特徴をご紹介します。" },
  { start: 52.3,  file: "scene2-02", text: "すべての処理がブラウザ内で完結。外部への通信は一切ありません。国立国会図書館が開発した高精度エンジンを搭載しています。" },
  { start: 65.5,  file: "scene2-03", text: "横書きだけでなく、古い書籍の縦書きテキストにも対応。ツールバー、ショートカット、右クリックメニューの3通りで起動できます。" },
  { start: 77.8,  file: "scene2-04", text: "正規表現でOCR結果を自動整形するクリーニング機能。UIは日本語と英語を自動で切り替えます。" },
  { start: 89.4,  file: "scene3-01", text: "プライバシーについて。このアプリはあなたのデータを一切外部に送りません。" },
  { start: 97.2,  file: "scene3-02", text: "画像のキャプチャ、OCRエンジン、AIモデル、認識結果。すべてがあなたのブラウザの中だけで動作します。" },
  { start: 108.0, file: "scene3-03", text: "外部サーバーとの通信は完全にブロック。画像もテキストも送信されません。" },
  { start: 116.1, file: "scene3-04", text: "ネットワークリクエストはゼロ。データ収集もゼロ。インターネットに接続していなくても、そのまま使えます。" },
  { start: 127.5, file: "scene4-01", text: "クリーニングルール機能をご紹介します。" },
  { start: 132.7, file: "scene4-02", text: "OCRの結果を、コピーする前に正規表現で自動整形できます。スペースの除去、カンマの削除、改行の整理。ルールは自由に追加・並べ替え可能です。" },
  { start: 148.1, file: "scene4-03", text: "たとえば、請求書の金額。OCRの生データにはカンマやスペースが含まれていますが、" },
  { start: 157.4, file: "scene4-04", text: "ルールを適用すると、不要な文字が除去され、きれいな数値に整形されます。" },
  { start: 166.5, file: "scene5-01", text: "技術的な仕組みをご説明します。" },
  { start: 171.5, file: "scene5-02", text: "コンテントスクリプトがページ上で範囲選択UIを表示し、座標をサービスワーカーに送ります。" },
  { start: 181.0, file: "scene5-03", text: "サービスワーカーがスクリーンショットを取得し、OCRワーカーに転送。" },
  { start: 188.7, file: "scene5-04", text: "ONNX Runtime Webでローカル推論を実行します。" },
  { start: 195.5, file: "scene5-05", text: "認識結果がコンテントスクリプトに返され、クリップボードに書き込まれます。すべてマニフェストV3ベースで、安全にローカル完結しています。" },
];

// English narration in katakana for VOICEVOX (subtitle SRT provides accurate English text)
const narrations_en = [
  { start: 1.5,   file: "scene0-01", text: "オフラインOCR。完全オフラインで安全な、範囲選択OCRです。" },
  { start: 11.3,  file: "scene1-01", text: "使い方はとてもシンプルです。" },
  { start: 16.0,  file: "scene1-02", text: "OCRしたいテキストの上を、マウスでドラッグするだけ。" },
  { start: 21.8,  file: "scene1-03", text: "国立国会図書館のOCRテクノロジーが、ブラウザ内でテキストを認識します。" },
  { start: 30.3,  file: "scene1-04", text: "結果は自動でクリップボードにコピー。すぐにペーストできます。" },
  { start: 37.7,  file: "scene1-05", text: "完全オフライン。日本語に最適化。縦書きサポート。ワンクリックで起動。" },
  { start: 47.5,  file: "scene2-01", text: "主なフィーチャーを紹介します。" },
  { start: 52.3,  file: "scene2-02", text: "すべてのプロセスがブラウザ内で完結。データは外部に送信されません。国立国会図書館が開発した、高精度エンジンを搭載しています。" },
  { start: 65.5,  file: "scene2-03", text: "横書きと縦書き、両方の日本語テキストをサポート。古い書籍にも対応。ツールバー、ショートカット、右クリックメニューから起動できます。" },
  { start: 77.8,  file: "scene2-04", text: "カスタム正規表現ルールでOCR結果をオートクリーン。UIは日本語と英語を自動で切り替えます。" },
  { start: 89.4,  file: "scene3-01", text: "プライバシーについて。このエクステンションはデータを外部に送信しません。" },
  { start: 97.2,  file: "scene3-02", text: "スクリーンショット、OCRエンジン、AIモデル、認識結果。すべてブラウザ内で完結します。" },
  { start: 108.0, file: "scene3-03", text: "外部サーバーとの通信は完全にブロック。画像もテキストも送信されません。" },
  { start: 116.1, file: "scene3-04", text: "ネットワークリクエスト、ゼロ。データコレクション、ゼロ。インターネット接続なしでも動作します。" },
  { start: 127.5, file: "scene4-01", text: "クリーニングルール機能を紹介します。" },
  { start: 132.7, file: "scene4-02", text: "コピー前に、正規表現でOCR結果をオートフォーマットできます。ルールの追加、並べ替え、切り替えが自由にできます。" },
  { start: 148.1, file: "scene4-03", text: "例えば、インボイスの金額。OCRの生データにはカンマやスペースが含まれています。" },
  { start: 157.4, file: "scene4-04", text: "ルールを適用すると、クリーンな数値にフォーマットされます。" },
  { start: 166.5, file: "scene5-01", text: "内部の仕組みを説明します。" },
  { start: 171.5, file: "scene5-02", text: "コンテントスクリプトが選択UIを表示し、座標をサービスワーカーに送ります。" },
  { start: 181.0, file: "scene5-03", text: "サービスワーカーがスクリーンショットをキャプチャし、OCRワーカーにフォワードします。" },
  { start: 188.7, file: "scene5-04", text: "ONNXランタイムウェブで、ローカル推論を実行します。" },
  { start: 195.5, file: "scene5-05", text: "結果がクリップボードに書き込まれます。すべてマニフェストV3ベースで、ローカルで完結しています。" },
];

const narrations = LANG === "en" ? narrations_en : narrations_ja;

const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const TOTAL_DURATION = 210;

// ── Directories ─────────────────────────────────────────────────────────────

const recordingsDir = resolve(__dirname, "recordings");
const voiceDir = resolve(__dirname, "voice");

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
  console.log(` Step 1: Recording scene videos [${LANG}] (WebM)`);
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
  console.log(` Step 2: Converting WebM → MP4 [${LANG}]`);
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

  const fullMp4 = resolve(recordingsDir, `full-video${suffix}.mp4`);
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${fullMp4}"`,
    { stdio: "pipe" }
  );
  console.log(`    → full-video${suffix}.mp4`);
}

// ── Step 3: Generate voice ──────────────────────────────────────────────────

async function generateVoice() {
  console.log("\n========================================");
  console.log(` Step 3: Generating narration [${LANG}] (VOICEVOX)`);
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

  console.log(`  Speaker: あいえるたん (ID: ${SPEAKER_ID})`);
  console.log(`  Language: ${LANG}\n`);

  const clips = [];

  for (const item of narrations) {
    const fileKey = `${item.file}${suffix}`;
    process.stdout.write(`  Generating ${fileKey}...`);

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
    const outPath = resolve(voiceDir, `${fileKey}.wav`);
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

  const narrationBase = `narration-full${suffix}`;
  const header = buildWavHeader(combinedPcm.length);
  const fullWav = Buffer.concat([header, combinedPcm]);
  writeFileSync(resolve(voiceDir, `${narrationBase}.wav`), fullWav);
  writeFileSync(resolve(voiceDir, `timestamps${suffix}.txt`), timestamps.join("\n") + "\n");
  console.log(`    → ${narrationBase}.wav (${TOTAL_DURATION}s)`);
  console.log(`    → timestamps${suffix}.txt`);

  // Convert to MP4-compatible audio (AAC)
  console.log("\n  Converting narration to AAC...");
  execSync(
    `ffmpeg -y -i "${resolve(voiceDir, `${narrationBase}.wav`)}" -c:a aac -b:a 192k "${resolve(voiceDir, `${narrationBase}.m4a`)}"`,
    { stdio: "pipe" }
  );
  console.log(`    → ${narrationBase}.m4a`);
}

// ── Step 4: Merge video + audio ─────────────────────────────────────────────

function mergeVideoAudio() {
  const videoPath = resolve(recordingsDir, `full-video${suffix}.mp4`);
  const audioPath = resolve(voiceDir, `narration-full${suffix}.m4a`);
  const outputName = `promo-video-${LANG}.mp4`;
  const outputPath = resolve(__dirname, outputName);

  if (!existsSync(videoPath)) {
    console.log(`\n  ⚠ full-video${suffix}.mp4 not found. Skipping merge.`);
    return;
  }
  if (!existsSync(audioPath)) {
    console.log(`\n  ⚠ narration-full${suffix}.m4a not found. Skipping merge.`);
    return;
  }

  console.log("\n========================================");
  console.log(` Step 4: Merging video + narration [${LANG}]`);
  console.log("========================================\n");

  execSync(
    `ffmpeg -y -i "${videoPath}" -i "${audioPath}" -c:v copy -c:a aac -shortest "${outputPath}"`,
    { stdio: "pipe" }
  );
  console.log(`  → ${outputName}\n`);
  console.log(`Done! Final video: store/video/${outputName}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log(`║   Offline OCR — Video Builder [${LANG}]    ║`);
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
