/**
 * 紹介動画 (v2) を作る: 台本の声 → 場面の時間 → teaser.html の録画 → 声と BGM を重ねて MP4。
 *
 * 必要なもの: VOICEVOX (localhost:50021)、ffmpeg、Playwright、bgm.mp3 (local-musicgen で作った曲。caption は README)
 *
 *   node store/video-v2/build.mjs              # 全部
 *   node store/video-v2/build.mjs --kana       # 声を作り、読みのカナだけ表示する
 */
import { chromium } from "playwright";
import { writeFileSync, readFileSync, mkdirSync, readdirSync, renameSync, rmSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const script = JSON.parse(readFileSync(resolve(HERE, "script.json"), "utf8"));
const VOICEVOX = "http://localhost:50021";
const OUT = resolve(HERE, "out");
const VOICE_DIR = resolve(OUT, "voice");
mkdirSync(VOICE_DIR, { recursive: true });

// ── 声 ──
async function synth(text) {
  const { speaker, speed, intonation } = script.voice;
  const q = await (await fetch(`${VOICEVOX}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`, { method: "POST" })).json();
  q.speedScale = speed;
  q.intonationScale = intonation;
  const kana = q.kana;
  const wav = Buffer.from(await (await fetch(`${VOICEVOX}/synthesis?speaker=${speaker}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q),
  })).arrayBuffer());
  return { wav, kana };
}

function wavSeconds(buf) {
  // VOICEVOX は 16bit PCM。data チャンクの大きさを byteRate で割る
  const byteRate = buf.readUInt32LE(28);
  let p = 12;
  while (p < buf.length) {
    const id = buf.toString("ascii", p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === "data") return size / byteRate;
    p += 8 + size;
  }
  throw new Error("no data chunk");
}

const timeline = [];
let t = script.head;
for (const [i, s] of script.scenes.entries()) {
  const file = resolve(VOICE_DIR, `${String(i + 1).padStart(2, "0")}-${s.id}.wav`);
  const { wav, kana } = await synth(s.say ?? s.text);
  writeFileSync(file, wav);
  const dur = wavSeconds(wav);
  console.log(`${s.id.padEnd(7)} ${dur.toFixed(2)}s  ${kana}`);
  const voiceAt = t + 0.3;
  const end = voiceAt + dur + (s.hold ?? 0) + script.gap;
  timeline.push({ id: s.id, start: +t.toFixed(3), voice: +voiceAt.toFixed(3), end: +end.toFixed(3), file, text: s.text });
  t = end;
}
const total = t + script.tail;
console.log(`total ${total.toFixed(2)}s`);
if (process.argv.includes("--kana")) process.exit(0);

// ── 録画 ── ページは start() を呼ぶまで最初の場面で止まっている。呼んだ時刻までを後で切る
const tl = timeline.map(({ id, start, end }) => ({ id, start, end }));
writeFileSync(resolve(OUT, "timeline.json"), JSON.stringify({ total, scenes: tl }, null, 2));
const recDir = resolve(OUT, "rec");
rmSync(recDir, { recursive: true, force: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: recDir, size: { width: 1920, height: 1080 } } });
const t0 = Date.now();
const page = await ctx.newPage();
await page.goto(`file://${resolve(HERE, "teaser.html")}`, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
const trim = (Date.now() - t0) / 1000;
await page.evaluate((x) => window.start(x), { total, scenes: tl });
await page.waitForTimeout(total * 1000 + 300);
await ctx.close();
await browser.close();
const webm = resolve(recDir, readdirSync(recDir).find((f) => f.endsWith(".webm")));
renameSync(webm, resolve(OUT, "teaser.webm"));

// ── 声と BGM を重ねる ──
const bgm = resolve(HERE, "bgm.mp3");
const args = ["-y", "-v", "error", "-ss", trim.toFixed(3), "-i", resolve(OUT, "teaser.webm")];
timeline.forEach((s) => args.push("-i", s.file));
if (existsSync(bgm)) args.push("-i", bgm);
// 声 (24kHz モノラル) と BGM を 48kHz ステレオにそろえてから重ねる
const fmt = "aformat=sample_rates=48000:channel_layouts=stereo";
const voices = timeline.map((s, i) => `[${i + 1}:a]${fmt},adelay=${Math.round(s.voice * 1000)}:all=1,volume=1.6[v${i}]`);
const mixIn = timeline.map((_, i) => `[v${i}]`).join("");
let filter = voices.join(";") + `;${mixIn}amix=inputs=${timeline.length}:normalize=0[nar]`;
if (existsSync(bgm)) {
  const b = timeline.length + 1;
  filter += `;[${b}:a]${fmt},atrim=0:${total.toFixed(2)},volume=0.22,afade=t=in:d=0.6,afade=t=out:st=${(total - 2).toFixed(2)}:d=2[bg];[nar][bg]amix=inputs=2:normalize=0[a]`;
} else {
  filter += `;[nar]anull[a]`;
}
const mp4 = resolve(HERE, "promo-video-v2-ja.mp4");
args.push("-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-t", total.toFixed(2),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-crf", "18", "-c:a", "aac", "-b:a", "192k", mp4);
execFileSync("ffmpeg", args, { stdio: "inherit" });
console.log(mp4);
