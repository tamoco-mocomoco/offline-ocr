/**
 * Generate narration for newspaper-demo short video.
 *
 * Usage: node social/newspaper-demo/generate-voice.mjs
 * Requires: VOICEVOX running on localhost:50021
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname);
mkdirSync(outputDir, { recursive: true });

const VOICEVOX_URL = "http://localhost:50021";
const SPEAKER_ID = 68; // あいえるたん
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const TOTAL_DURATION = 33;

const narrations = [
  { start: 0.0,  file: "np-01", text: "Chrome拡張でOCR作ってみた！" },
  { start: 5.0,  file: "np-02", text: "新聞の縦書きコラムも" },
  { start: 9.0,  file: "np-03", text: "ぎゅっと囲むだけで" },
  { start: 13.5, file: "np-04", text: "横書きでサクッとコピーできるよ！" },
  { start: 19.5, file: "np-05", text: "しかも通信ゼロ。データは外に出ないよ" },
  { start: 23.0, file: "np-06", text: "アプリじゃなくて、ブラウザの拡張機能ね" },
  { start: 26.0, file: "np-07", text: "Chromeストアでオフラインオーシーアールって検索してね" },
];

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

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

async function main() {
  console.log("Generating newspaper-demo narration...\n");
  const clips = [];
  for (const item of narrations) {
    process.stdout.write(`  ${item.file}...`);
    const queryRes = await fetch(
      `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(item.text)}&speaker=${SPEAKER_ID}`,
      { method: "POST" },
    );
    const query = await queryRes.json();
    query.speedScale = 1.15;
    query.intonationScale = 1.3;
    const synthRes = await fetch(
      `${VOICEVOX_URL}/synthesis?speaker=${SPEAKER_ID}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) },
    );
    const wav = Buffer.from(await synthRes.arrayBuffer());
    const outPath = resolve(outputDir, `${item.file}.wav`);
    writeFileSync(outPath, wav);
    const pcm = wav.subarray(44);
    const duration = pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE);
    clips.push({ ...item, pcm, duration });
    console.log(` ${duration.toFixed(1)}s (${item.start.toFixed(1)} → ${(item.start + duration).toFixed(1)})`);
  }

  console.log("\n=== Overlap Check ===\n");
  let hasOverlap = false;
  for (let i = 0; i < clips.length - 1; i++) {
    const curr = clips[i];
    const next = clips[i + 1];
    const gap = next.start - (curr.start + curr.duration);
    const status = gap < 0 ? "❌ OVERLAP" : gap < 0.3 ? "⚠️  TIGHT" : "✓";
    if (gap < 0) hasOverlap = true;
    console.log(`  ${curr.file} → ${next.file}  gap: ${gap.toFixed(1)}s  ${status}`);
  }
  if (hasOverlap) { console.log("\n❌ Overlaps found!"); process.exit(1); }

  console.log("\n  Building combined narration...");
  const totalSamples = SAMPLE_RATE * TOTAL_DURATION;
  const combinedPcm = Buffer.alloc(totalSamples * BYTES_PER_SAMPLE, 0);
  const timestamps = [];
  for (const clip of clips) {
    const offsetBytes = Math.round(clip.start * SAMPLE_RATE) * BYTES_PER_SAMPLE;
    const maxCopy = Math.min(clip.pcm.length, combinedPcm.length - offsetBytes);
    if (maxCopy > 0) clip.pcm.copy(combinedPcm, offsetBytes, 0, maxCopy);
    timestamps.push(
      `${formatTime(clip.start)} - ${formatTime(clip.start + clip.duration)}  ${clip.file}  "${clip.text}"`,
    );
  }
  const header = buildWavHeader(combinedPcm.length);
  const fullWav = Buffer.concat([header, combinedPcm]);
  writeFileSync(resolve(outputDir, "newspaper-narration.wav"), fullWav);
  writeFileSync(resolve(outputDir, "newspaper-timestamps.txt"), timestamps.join("\n") + "\n");
  console.log(`    → newspaper-narration.wav (${TOTAL_DURATION}s)`);
  console.log(`    → newspaper-timestamps.txt`);
  console.log("\nDone!");
}

main().catch((e) => { console.error(e); process.exit(1); });
