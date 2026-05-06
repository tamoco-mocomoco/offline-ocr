---
name: create-promo-video
description: プロモーション動画をHTML+CSSアニメーションで作成するノウハウ
user_invocable: true
---

プロモーション動画をHTML + CSSアニメーション + Playwright録画で作成するノウハウ。

## 設計方針

- 各シーンは独立したHTMLファイル（JavaScriptなし、CSSアニメーションのみ）
- Playwrightの `recordVideo` でブラウザ画面をそのまま録画
- ナレーションのタイミングに合わせて `animation-delay` を設定
- ffmpegでシーン結合 + 音声合成

## HTMLシーンのルール

- bodyに `.slide` div、指定解像度（例: 1920×1080）
- body背景: #111（余白が見えても黒）
- フォント: Google Fonts import
- アニメーションはすべて `@keyframes` + `animation-delay` で制御
- 1シーン = 1ファイル（シーン間の遷移はffmpegで処理）

## アニメーションパターン集

```css
/* 基本: フェード + スライドアップ */
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* インパクト: スラムイン（拡大→縮小→等倍） */
@keyframes titleSlam {
  0%   { opacity: 0; transform: scale(1.5) translateY(-20px); }
  60%  { opacity: 1; transform: scale(0.95) translateY(5px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

/* バウンス + 回転（アイコン登場） */
@keyframes iconBounce {
  0%   { opacity: 0; transform: scale(0.3) rotate(-10deg); }
  60%  { opacity: 1; transform: scale(1.1) rotate(2deg); }
  100% { opacity: 1; transform: scale(1) rotate(0deg); }
}

/* ポップイン（バッジ、タグ） */
@keyframes tagPop {
  0%   { opacity: 0; transform: scale(0.5); }
  70%  { opacity: 1; transform: scale(1.1); }
  100% { opacity: 1; transform: scale(1); }
}

/* 繰り返し: パルスリング */
@keyframes pulseRing {
  0%   { opacity: 0.6; transform: translate(-50%,-50%) scale(1); }
  100% { opacity: 0; transform: translate(-50%,-50%) scale(1.5); }
}

/* 繰り返し: グロー浮遊（背景演出） */
@keyframes glowFloat {
  0%, 100% { opacity: 0.5; transform: translateY(0); }
  50%      { opacity: 1; transform: translateY(-20px); }
}

/* 繰り返し: 呼吸するグロウ（CTA強調） */
@keyframes ctaPulse {
  0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
  50%      { box-shadow: 0 4px 30px rgba(91,155,213,0.4); }
}

/* 光沢エフェクト（アイコンに使用） */
@keyframes iconShine {
  from { opacity: 0; transform: translateX(-30%) translateY(-30%); }
  50%  { opacity: 1; }
  to   { opacity: 0; transform: translateX(30%) translateY(30%); }
}

/* リング拡散（背景演出） */
@keyframes ringExpand {
  from { opacity: 0.5; transform: translate(-50%,-50%) scale(0.3); }
  to   { opacity: 0; transform: translate(-50%,-50%) scale(1); }
}
```

## 要素の登場順を `animation-delay` で制御

```css
.feature-card:nth-child(1) { animation: fadeSlideUp 0.6s ease forwards 4.8s; }
.feature-card:nth-child(2) { animation: fadeSlideUp 0.6s ease forwards 9.5s; }
.feature-card:nth-child(3) { animation: fadeSlideUp 0.6s ease forwards 18.0s; }
```

## ナレーションとのタイミング合わせ

1. ナレーションテキストをTTSで生成して**実際の発話秒数を計測**
2. `start` + `duration` で各セリフの時間帯を確定
3. **被りチェック**: `次の開始 - 前の終了 > 0` を自動検証
4. CSSの `animation-delay` をナレーションの `start` に合わせて設定
5. 被りが出たらstartを後ろにずらすか、テキストを短くする

## 英語版の作り方

- HTMLのテキストだけ翻訳、CSS/アニメーションは同一
- ファイル名に `-en` サフィックス
- ナレーションの発話時間が異なるので被りチェックを再実行
- 日本語TTSで英語を読ませると不自然。英語版はナレーションなし + SRT字幕が現実的

## ffmpegでの合成

```bash
# WebM→MP4変換
ffmpeg -y -i scene.webm -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -an scene.mp4

# シーン結合
ffmpeg -y -f concat -safe 0 -i concat-list.txt -c copy full-video.mp4

# クロスフェード
ffmpeg -y -i s0.mp4 -i s1.mp4 -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.8:offset=10[v]" -map "[v]" out.mp4

# 音声合成
ffmpeg -y -i video.mp4 -i narration.m4a -c:v copy -c:a aac -shortest output.mp4
```

## Remotionという選択肢

React+TypeScriptで動画を作れるフレームワーク。より本格的な動画制作が必要な場合に検討。ただしストア素材レベルならHTML+CSSで十分。
