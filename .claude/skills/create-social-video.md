---
name: create-social-video
description: SNSショート動画をHTML+実写+TTSで作成するノウハウ
user_invocable: true
---

TikTok / YouTube Shorts / Instagram Reels 向けショート動画を作成するノウハウ。

## 構成パターン

**HTMLイントロ → 実写デモ → HTMLアウトロ** の3パート構成が効果的。

| パート | 素材 | 役割 | 尺 |
|---|---|---|---|
| イントロ | HTML | 何の動画かを一瞬で伝える | 3〜4秒 |
| デモ | 実写 | 実際の操作を見せる | 10〜20秒 |
| アウトロ | HTML | 訴求ポイント + CTA | 8〜15秒 |

合計 **30秒前後** が理想（完走率を意識）。

## 解像度

- 縦型: **1080×1920**（9:16）が推奨
- 実写素材が小さい場合: ffmpegで中央配置 + 背景埋め
  ```
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=#1a1a1a"
  ```
- 実写が遅い場合の速度調整: `-vf "setpts=PTS/1.2"` (1.2倍速)

## フォルダ構成

動画ごとにフォルダを分ける:
```
social/
├── scripts.md          ← 全体の企画・台本
└── {動画名}/
    ├── intro.html      ← イントロ
    ├── outro.html      ← アウトロ
    ├── {素材}.mov      ← 実写素材
    ├── {台本}.md       ← 個別台本
    ├── generate-voice.mjs ← TTS生成
    ├── build.mjs       ← ビルドスクリプト
    ├── subtitles.srt   ← テロップ
    └── {出力}.mp4      ← 完成動画
```

## イントロHTML演出

- アイコンをバウンス+回転で登場（`iconBounce`）
- タイトルをスラムイン（`titleSlam` — scale 1.5→1）
- サブタイトル、タグをフェードアップ
- 背景にリング波紋（`ringExpand`）、グロー浮遊（`glowFloat`）
- アイコンに光沢エフェクト（`iconShine`）
- 尺: ナレーションの最初のセリフが**言い終わるまで**余裕を持たせる

## アウトロHTML演出

- メインメッセージ: スラム登場 + パルスリング
- 注意書き: 色付きボーダーのバッジがバウンスイン
- CTA: ロゴ + 検索ボックス風UIが呼吸するグロウ（`ctaPulse`）
- 各要素の `animation-delay` はナレーションに合わせる
- 尺: ナレーション全セリフ + 余白

## テロップ (SRT)

- **デモ部分のキーワードのみ**入れる。全セリフを字幕にしない
- イントロ/アウトロはHTML自体にテキストがあるのでテロップ不要
- ffmpegの `subtitles` フィルター使用（`ffmpeg-full` / libass付きビルドが必要）
  ```bash
  brew install ffmpeg-full  # macOS
  ```
- スタイル例（縦型1080px幅で改行しないサイズ）:
  ```
  subtitles=subtitles.srt:force_style='FontSize=18,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=40'
  ```

## ナレーションの口調

SNSは砕けた口調が有効:
- ❌「画像内のテキストを認識してクリップボードにコピーします」
- ✅「画像の文字、コピーできるようにしたよ」
- ❌「通信は一切行いません」
- ✅「しかも通信ゼロ。データは外に出ないよ」
- ❌「Chrome Web Storeで公開中」
- ✅「気になったら使ってみてね」

## TTS設定（VOICEVOX例）

- テンション高め: `speedScale: 1.15`, `intonationScale: 1.3`
- `audio_query` → パラメータ調整 → `synthesis` のフロー
- 英語はVOICEVOXでは不自然（カタカナ変換も試したが非推奨）

## ナレーションのタイミング調整手順

1. 実写動画のフレームを切り出して（`ffmpeg -vf fps=4`）シーン切替時刻を特定
2. イントロ秒数を**全タイミングにオフセットとして加算**（忘れがち）
3. 速度変更した場合: `元の時刻 ÷ 倍速 + イントロ秒数` で再計算
4. TTSで生成して発話秒数を計測
5. **被りチェック**: `次のstart - (前のstart + duration) > 0` を自動検証
6. アウトロのナレーション開始はデモ最後のセリフ終了 + 0.4秒以上の余白

## 音声ファイルのパスに注意

- 生成スクリプトの出力先とビルドスクリプトの参照先が一致しているか確認
- 古いファイルが残っていると `-shortest` で意図しない尺になる

## 演出の段階的追加

1. まずナレーション + 映像の結合で内容を確認
2. テロップを追加
3. 集中線やフラッシュなどの演出は必要に応じて後から追加
