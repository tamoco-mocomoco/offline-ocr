/**
 * Build the PDF-promo video from scene HTMLs.
 *
 * Usage:
 *   node store/video/pdf-promo/build.mjs                # video-only (silent)
 *   node store/video/pdf-promo/build.mjs --with-voice   # + VOICEVOX narration
 *
 * Prerequisites:
 *   - Playwright installed (`npm install -g playwright` or use bundled one)
 *   - ffmpeg installed (`brew install ffmpeg`)
 *   - (optional, for --with-voice) VOICEVOX desktop app running on localhost:50021
 *
 * Output:
 *   store/video/pdf-promo/recordings/scene*.mp4  (individual scenes)
 *   store/video/pdf-promo/pdf-promo-ja.mp4       (final composited video)
 */

import { createRequire } from "module";
import {
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  renameSync,
  statSync,
} from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const HERE = dirname(fileURLToPath(import.meta.url));
const RECORDINGS = resolve(HERE, "recordings");
const VOICE = resolve(HERE, "voice");
const OUTPUT = resolve(HERE, "pdf-promo-ja.mp4");

const args = process.argv.slice(2);
const WITH_VOICE = args.includes("--with-voice");
const VIDEO_ONLY = args.includes("--video-only") || !WITH_VOICE;

const FADE_DURATION = 0.8; // seconds

// ── Scenes (matches narration.txt timings) ─────────────────────────────────

const scenes = [
  { file: "scene0-title.html", duration: 6_000 },
  { file: "scene1-problem.html", duration: 16_000 },
  { file: "scene2-solution.html", duration: 14_000 },
  { file: "scene3-usage.html", duration: 14_000 },
  { file: "scene4-outro.html", duration: 10_000 },
];

// Narration timing (seconds from start of full video, after xfade compaction).
// Each fade shortens the timeline by FADE_DURATION, so a scene starting at
// cumulative-with-fades time is what we need for voice sync.
const narrations = [
  { start: 2.0, file: "scene0-01", text: "オフラインOCR。バージョン0.8.0で、PDFにも対応しました。" },
  { start: 6.0, file: "scene1-01", text: "実はChrome拡張でPDFを扱うのって、意外と大変なんです。" },
  { start: 10.0, file: "scene1-02", text: "ローカルのPDFを開くには、ユーザーがファイルURLへのアクセスを自分で許可する必要があります。" },
  { start: 15.0, file: "scene1-03", text: "Chromeの内蔵PDFビューアには、拡張のスクリプトを注入できません。" },
  { start: 18.5, file: "scene1-04", text: "PDFを描画する仕組みを、拡張機能側で持ち込むしかない。" },
  { start: 22.0, file: "scene2-01", text: "そこで、pdfjs-distを拡張本体に同梱しました。" },
  { start: 25.5, file: "scene2-02", text: "ローカルPDFをpdfjs-distで画像に描画して、そのままDEIMとPARSeqにかける。" },
  { start: 31.0, file: "scene2-03", text: "権限設定は不要、通信ゼロも維持。既存の選択UIもそのまま動きます。" },
  { start: 36.0, file: "scene3-01", text: "使い方はかんたん。ポップアップに新しく「PDFを開く」ボタンが増えています。" },
  { start: 41.5, file: "scene3-02", text: "PDFを選ぶとビューアが開いて、ページ移動はキーでもボタンでもスムーズに。" },
  { start: 46.5, file: "scene3-03", text: "あとはドラッグで範囲選択、結果はクリップボードにコピーされます。" },
  { start: 51.0, file: "scene4-01", text: "手元のPDFを、通信ゼロで、その場で読める。オフラインOCR、今すぐお試しください。" },
];

const VOICEVOX_URL = "http://localhost:50021";
const SPEAKER_ID = 68; // あいえるたん

// ── Step 1: Record each scene as WebM → MP4 ────────────────────────────────

async function recordScenes() {
  if (!existsSync(RECORDINGS)) mkdirSync(RECORDINGS, { recursive: true });

  const browser = await chromium.launch();
  for (const scene of scenes) {
    const filePath = resolve(HERE, scene.file);
    const fileUrl = `file://${filePath}`;
    const outName = scene.file.replace(".html", "");
    console.log(`Recording ${scene.file} (${scene.duration / 1000}s)...`);

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: RECORDINGS, size: { width: 1920, height: 1080 } },
    });
    const page = await context.newPage();
    await page.goto(fileUrl, { waitUntil: "load" });
    await page.waitForTimeout(scene.duration);
    await context.close();

    // Rename the newest webm to sceneN.webm
    const webms = readdirSync(RECORDINGS)
      .filter((f) => f.endsWith(".webm"))
      .map((f) => ({
        name: f,
        mtime: statSync(resolve(RECORDINGS, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    const latest = webms[0].name;
    const webmDest = resolve(RECORDINGS, `${outName}.webm`);
    if (existsSync(webmDest)) unlinkSync(webmDest);
    renameSync(resolve(RECORDINGS, latest), webmDest);

    // Convert WebM → MP4 with fixed length (Playwright's webm sometimes has
    // extra frames; ffmpeg -t clamps to the intended duration).
    const mp4Dest = resolve(RECORDINGS, `${outName}.mp4`);
    if (existsSync(mp4Dest)) unlinkSync(mp4Dest);
    execSync(
      `ffmpeg -y -i "${webmDest}" -t ${scene.duration / 1000} -c:v libx264 -pix_fmt yuv420p -crf 18 -preset fast "${mp4Dest}"`,
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    console.log(`  → ${outName}.mp4`);
  }
  await browser.close();
}

// ── Step 2: Merge scenes with xfade transitions ────────────────────────────

function mergeScenes() {
  const inputs = scenes
    .map((s) => `-i "${resolve(RECORDINGS, s.file.replace(".html", ".mp4"))}"`)
    .join(" ");

  // Build xfade filter chain
  const N = scenes.length;
  let filter = "";
  let cumulative = scenes[0].duration / 1000;
  for (let i = 1; i < N; i++) {
    const offset = (cumulative - FADE_DURATION).toFixed(3);
    const prevLabel = i === 1 ? "[0:v][1:v]" : `[v${i - 1}][${i}:v]`;
    const outLabel = `[v${i}]`;
    filter += `${prevLabel}xfade=transition=fade:duration=${FADE_DURATION}:offset=${offset}${outLabel};`;
    cumulative += scenes[i].duration / 1000 - FADE_DURATION;
  }
  filter = filter.replace(/;$/, "");
  const finalV = `[v${N - 1}]`;
  const fadedVideo = resolve(RECORDINGS, "faded-video.mp4");

  console.log(`Merging scenes with ${FADE_DURATION}s crossfades...`);
  console.log(`  Total (with fades): ~${cumulative.toFixed(1)}s`);
  execSync(
    `ffmpeg -y ${inputs} -filter_complex "${filter}" -map "${finalV}" -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p "${fadedVideo}"`,
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log(`  → faded-video.mp4`);
  return { fadedVideo, totalDuration: cumulative };
}

// ── Step 3: Generate narration via VOICEVOX (optional) ─────────────────────

async function generateVoice() {
  if (!existsSync(VOICE)) mkdirSync(VOICE, { recursive: true });

  console.log("Generating narration via VOICEVOX...");

  // Check server
  try {
    const r = await fetch(`${VOICEVOX_URL}/version`);
    if (!r.ok) throw new Error(`status ${r.status}`);
  } catch (e) {
    console.error(
      `\n  VOICEVOX not reachable at ${VOICEVOX_URL}. Start VOICEVOX Desktop app and retry.\n  (${e.message})`,
    );
    process.exit(1);
  }

  const clips = [];
  for (const n of narrations) {
    const outWav = resolve(VOICE, `${n.file}.wav`);
    console.log(`  ${n.file}: "${n.text.slice(0, 30)}..."`);

    // 1) query
    const q = await fetch(
      `${VOICEVOX_URL}/audio_query?speaker=${SPEAKER_ID}&text=${encodeURIComponent(n.text)}`,
      { method: "POST" },
    );
    const params = await q.json();
    params.speedScale = 1.05;
    params.intonationScale = 1.2;

    // 2) synthesize
    const s = await fetch(
      `${VOICEVOX_URL}/synthesis?speaker=${SPEAKER_ID}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      },
    );
    writeFileSync(outWav, Buffer.from(await s.arrayBuffer()));
    clips.push({ ...n, wav: outWav });
  }

  // Combine into a single timed track using ffmpeg amix + delays
  const totalDur = 65; // safe upper bound (~60s + tail)
  const parts = clips
    .map(
      (c, i) =>
        `-itsoffset ${c.start.toFixed(3)} -i "${c.wav}"`,
    )
    .join(" ");
  const amixInputs = clips
    .map((_, i) => `[${i + 1}:a]adelay=0|0[a${i}]`)
    .join(";");
  const amixMerge = clips.map((_, i) => `[a${i}]`).join("");
  const filter = `${amixInputs};${amixMerge}amix=inputs=${clips.length}:duration=longest:normalize=0[aout]`;

  const outAudio = resolve(VOICE, "narration-full.m4a");
  execSync(
    `ffmpeg -y -f lavfi -t ${totalDur} -i "anullsrc=r=44100:cl=stereo" ${parts} -filter_complex "${filter}" -map "[aout]" -c:a aac -b:a 192k "${outAudio}"`,
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log(`  → narration-full.m4a`);
  return outAudio;
}

// ── Step 4: Merge video + narration ────────────────────────────────────────

function mergeVideoAudio(fadedVideo, narrationFile) {
  if (!narrationFile) {
    console.log("Skipping audio merge (video-only mode)");
    // Just copy video → OUTPUT
    execSync(`cp "${fadedVideo}" "${OUTPUT}"`, { stdio: "inherit" });
  } else {
    console.log("Merging video + narration...");
    execSync(
      `ffmpeg -y -i "${fadedVideo}" -i "${narrationFile}" -c:v copy -c:a aac -shortest "${OUTPUT}"`,
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  }
  console.log(`  → ${OUTPUT}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`=== PDF-promo build (${WITH_VOICE ? "video + voice" : "video only"}) ===\n`);

await recordScenes();
console.log();
mergeScenes();
console.log();

let narrationFile = null;
if (WITH_VOICE) {
  narrationFile = await generateVoice();
  console.log();
}

mergeVideoAudio(resolve(RECORDINGS, "faded-video.mp4"), narrationFile);

const finalDur = execSync(
  `ffprobe -v error -show_entries format=duration -of csv=p=0 "${OUTPUT}"`,
).toString().trim();
console.log(`\n=== Done! ${OUTPUT} (${finalDur}s) ===`);
