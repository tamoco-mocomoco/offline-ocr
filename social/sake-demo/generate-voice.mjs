/**
 * Generate narration for sake-demo short video.
 *
 * Usage: node social/sake-demo/generate-voice.mjs
 * Requires: VOICEVOX running on localhost:50021
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname);
mkdirSync(outputDir, { recursive: true });

const VOICEVOX_URL = "http://localhost:50021";
const SPEAKER_ID = 68;
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const TOTAL_DURATION = 33;

const narrations = [
  { start: 0.0,  file: "sk-01", text: "Chrome拡張でOCR作ってみた！" },
  { start: 5.0,  file: "sk-02", text: "日本酒のラベルも" },
  { start: 9.0,  file: "sk-03", text: "ぎゅっと囲むだけで" },
  { start: 13.5, file: "sk-04", text: "横書きでサクッとコピーできるよ！" },
  { start: 19.5, file: "sk-05", text: "しかも通信ゼロ。データは外に出ないよ" },
  { start: 23.0, file: "sk-06", text: "アプリじゃなくて、ブラウザの拡張機能ね" },
  { start: 26.0, file: "sk-07", text: "Chromeストアでオフラインオーシーアールって検索してね" },
];

function buildWavHeader(pcmLength) {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * 1 * BYTES_PER_SAMPLE;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
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
  console.log("Generating sake-demo narration...\n");
  const clips = [];
  for (const item of narrations) {
    process.stdout.write(`  ${item.file}...`);
    const queryRes = await fetch(`${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(item.text)}&speaker=${SPEAKER_ID}`, { method: "POST" });
    const query = await queryRes.json();
    query.speedScale = 1.15;
    query.intonationScale = 1.3;
    const synthRes = await fetch(`${VOICEVOX_URL}/synthesis?speaker=${SPEAKER_ID}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query),
    });
    const wav = Buffer.from(await synthRes.arrayBuffer());
    writeFileSync(resolve(outputDir, `${item.file}.wav`), wav);
    const pcm = wav.subarray(44);
    const duration = pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE);
    clips.push({ ...item, pcm, duration });
    console.log(` ${duration.toFixed(1)}s (${item.start.toFixed(1)} → ${(item.start + duration).toFixed(1)})`);
  }
  console.log("\n=== Overlap Check ===\n");
  let hasOverlap = false;
  for (let i = 0; i < clips.length - 1; i++) {
    const c = clips[i], n = clips[i+1];
    const gap = n.start - (c.start + c.duration);
    const tag = gap < 0 ? "❌ OVERLAP" : gap < 0.3 ? "⚠️  TIGHT" : "✓";
    if (gap < 0) hasOverlap = true;
    console.log(`  ${c.file} → ${n.file}  gap: ${gap.toFixed(1)}s  ${tag}`);
  }
  if (hasOverlap) { console.log("\n❌"); process.exit(1); }
  console.log("\n  Building combined narration...");
  const total = SAMPLE_RATE * TOTAL_DURATION;
  const combined = Buffer.alloc(total * BYTES_PER_SAMPLE, 0);
  const ts = [];
  for (const c of clips) {
    const off = Math.round(c.start * SAMPLE_RATE) * BYTES_PER_SAMPLE;
    const m = Math.min(c.pcm.length, combined.length - off);
    if (m > 0) c.pcm.copy(combined, off, 0, m);
    ts.push(`${formatTime(c.start)} - ${formatTime(c.start + c.duration)}  ${c.file}  "${c.text}"`);
  }
  writeFileSync(resolve(outputDir, "sake-narration.wav"), Buffer.concat([buildWavHeader(combined.length), combined]));
  writeFileSync(resolve(outputDir, "sake-timestamps.txt"), ts.join("\n") + "\n");
  console.log(`    → sake-narration.wav (${TOTAL_DURATION}s)`);
  console.log("\nDone!");
}
main().catch((e) => { console.error(e); process.exit(1); });
