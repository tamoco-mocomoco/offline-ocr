/**
 * Generate narration audio using VOICEVOX API.
 * Outputs individual WAV files + a combined single WAV with silence gaps.
 *
 * Prerequisites:
 *   - VOICEVOX app running (localhost:50021)
 *
 * Usage:
 *   node store/video/generate-voice.mjs
 *
 * Output:
 *   store/video/voice/scene0-01.wav ... (individual clips)
 *   store/video/voice/narration-full.wav (combined with timing)
 *   store/video/voice/timestamps.txt (timecodes for editing)
 */

import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, "voice");
mkdirSync(outputDir, { recursive: true });

const VOICEVOX_URL = "http://localhost:50021";

// Speaker ID: 68 = あいえるたん(ノーマル)
// See full list: http://localhost:50021/speakers
const SPEAKER_ID = 68;

// Each entry has a start time (seconds from video start) and narration text.
// Silence is inserted between clips to match the animation timing.
const narrations = [
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

const SAMPLE_RATE = 24000; // VOICEVOX default
const BYTES_PER_SAMPLE = 2; // 16-bit PCM

async function synthesize(text, speaker) {
  const queryRes = await fetch(
    `${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
    { method: "POST" }
  );
  if (!queryRes.ok) throw new Error(`audio_query failed: ${queryRes.status}`);
  const query = await queryRes.json();

  const synthRes = await fetch(
    `${VOICEVOX_URL}/synthesis?speaker=${speaker}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    }
  );
  if (!synthRes.ok) throw new Error(`synthesis failed: ${synthRes.status}`);
  return Buffer.from(await synthRes.arrayBuffer());
}

/** Extract raw PCM data from a WAV buffer (skip 44-byte header) */
function wavToPcm(wavBuf) {
  return wavBuf.subarray(44);
}

/** Create silence PCM buffer for given duration in seconds */
function silencePcm(durationSec) {
  const numSamples = Math.round(SAMPLE_RATE * durationSec);
  return Buffer.alloc(numSamples * BYTES_PER_SAMPLE, 0);
}

/** Build a WAV header for raw PCM data */
function buildWavHeader(pcmLength) {
  const header = Buffer.alloc(44);
  const numChannels = 1;
  const byteRate = SAMPLE_RATE * numChannels * BYTES_PER_SAMPLE;
  const blockAlign = numChannels * BYTES_PER_SAMPLE;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // chunk size
  header.writeUInt16LE(1, 20);  // PCM
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
  // Check VOICEVOX is running
  try {
    const res = await fetch(`${VOICEVOX_URL}/version`);
    const version = await res.text();
    console.log(`VOICEVOX version: ${version}`);
  } catch {
    console.error("Error: VOICEVOX is not running. Please start the app first.");
    process.exit(1);
  }

  console.log(`Using speaker ID: ${SPEAKER_ID} (あいえるたん)`);
  console.log(`Output: ${outputDir}\n`);

  // Generate individual clips
  const clips = [];
  for (const item of narrations) {
    process.stdout.write(`Generating ${item.file}...`);
    const wav = await synthesize(item.text, SPEAKER_ID);
    const outPath = resolve(outputDir, `${item.file}.wav`);
    writeFileSync(outPath, wav);

    const pcm = wavToPcm(wav);
    const durationSec = pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE);
    clips.push({ ...item, pcm, duration: durationSec });
    console.log(` done (${durationSec.toFixed(1)}s)`);
  }

  // Build combined WAV with timing
  console.log("\nBuilding combined narration...");
  const totalDuration = 210; // total video length in seconds
  const totalSamples = SAMPLE_RATE * totalDuration;
  const combinedPcm = Buffer.alloc(totalSamples * BYTES_PER_SAMPLE, 0);

  const timestamps = [];

  for (const clip of clips) {
    const offsetBytes = Math.round(clip.start * SAMPLE_RATE) * BYTES_PER_SAMPLE;
    clip.pcm.copy(combinedPcm, offsetBytes, 0, Math.min(clip.pcm.length, combinedPcm.length - offsetBytes));
    timestamps.push(`${formatTime(clip.start)} - ${formatTime(clip.start + clip.duration)}  ${clip.file}  "${clip.text}"`);
  }

  // Write combined WAV
  const header = buildWavHeader(combinedPcm.length);
  const fullWav = Buffer.concat([header, combinedPcm]);
  const fullPath = resolve(outputDir, "narration-full.wav");
  writeFileSync(fullPath, fullWav);
  console.log(`→ ${fullPath} (${totalDuration}s)`);

  // Write timestamps
  const tsPath = resolve(outputDir, "timestamps.txt");
  writeFileSync(tsPath, timestamps.join("\n") + "\n");
  console.log(`→ ${tsPath}`);

  console.log(`\nAll done! ${clips.length} clips + 1 combined file generated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
