/**
 * Generate narration for card-demo short video.
 *
 * Usage: node social/generate-card-voice.mjs
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
const TOTAL_DURATION = 32; // イントロ4s + デモ12.9s + アウトロ15s

const narrations = [
  // イントロ (0〜4s)
  { start: 0.0,  file: "card-01", text: "Chrome拡張でOCR作ってみた！" },
  // デモ (4〜23.4s) — card-demo.movの時間 + 4秒イントロオフセット
  { start: 3.0,  file: "card-02", text: "画像の文字、コピーできるようにしたよ" },  // イントロ終盤〜デモ冒頭にかけて
  { start: 7.0,  file: "card-03", text: "右クリックからOCR起動して" },             // 右クリックメニュー表示(1.5s+4=5.5, 前が6.5で終わるので7.0)
  { start: 9.5,  file: "card-04", text: "コピーしたいとこ囲むだけ" },             // ドラッグ中(4.5s+4=8.5, 前が9.2で終わるので9.5)
  { start: 13.0, file: "card-05", text: "ちょっと待つと…" },                     // 選択完了、処理待ち(9s+4=13)
  { start: 16.5, file: "card-06", text: "はい、コピーできた！" },                 // アラート表示(12.5s+4=16.5)
  // アウトロ — 16.9sからアウトロ開始、HTML演出に合わせる
  { start: 18.5, file: "card-07", text: "しかも通信ゼロ。データは外に出ないよ" },   // shield + テキスト(+1.0s)
  { start: 22.0, file: "card-08", text: "アプリじゃなくて、ブラウザの拡張機能ね" },  // note badge(+4.0s)
  { start: 25.5, file: "card-09", text: "Chromeストアでオフラインオーシーアールって検索してね" }, // CTA(+7.0s)
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
  console.log("Generating card-demo narration...\n");

  const clips = [];

  for (const item of narrations) {
    process.stdout.write(`  ${item.file}...`);

    const queryRes = await fetch(
      `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(item.text)}&speaker=${SPEAKER_ID}`,
      { method: "POST" }
    );
    const query = await queryRes.json();

    // テンション高めに調整
    query.speedScale = 1.15;      // 少し速め
    query.intonationScale = 1.3;  // 抑揚を強く

    const synthRes = await fetch(
      `${VOICEVOX_URL}/synthesis?speaker=${SPEAKER_ID}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) }
    );
    const wav = Buffer.from(await synthRes.arrayBuffer());

    const outPath = resolve(outputDir, `${item.file}.wav`);
    writeFileSync(outPath, wav);

    const pcm = wav.subarray(44);
    const duration = pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE);
    clips.push({ ...item, pcm, duration });
    console.log(` ${duration.toFixed(1)}s (${item.start.toFixed(1)} → ${(item.start + duration).toFixed(1)})`);
  }

  // Check overlaps
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

  if (hasOverlap) {
    console.log("\n❌ Overlaps found! Adjust start times.");
    process.exit(1);
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
  writeFileSync(resolve(outputDir, "card-narration.wav"), fullWav);
  writeFileSync(resolve(outputDir, "card-timestamps.txt"), timestamps.join("\n") + "\n");
  console.log(`    → card-narration.wav (${TOTAL_DURATION}s)`);
  console.log(`    → card-timestamps.txt`);

  console.log("\nDone!");
}

main().catch((e) => { console.error(e); process.exit(1); });
