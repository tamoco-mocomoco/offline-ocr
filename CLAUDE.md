# CLAUDE.md — オフラインOCR Chrome拡張

## プロジェクト概要

ブラウザ内で完結するオフライン日本語OCR Chrome拡張機能。
国立国会図書館のNDLOCR技術（DEIM + PARSeq）をONNX Runtime Web (WASM)で動かす。
通信ゼロ、データ送信なし。

- Chrome Web Store: https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd
- GitHub: https://github.com/tamoco-mocomoco/offline-ocr
- GitHub Pages: https://tamoco-mocomoco.github.io/offline-ocr/

## ビルド・テスト・デプロイ

```bash
npm run build          # tsc --noEmit && vite build → dist/
npm test               # vitest run (86テスト)
npm run test:watch     # vitest (watchモード)
```

- zipビルド: `npm run build && zip -r offline-ocr.zip dist/ -x "*.DS_Store"`
- バージョン変更時は `public/manifest.json` と `package.json` の両方を更新
- Chrome Web Storeへのアップロード時はバージョン番号を必ず上げる（同一バージョンは自動更新されない）

## アーキテクチャ

3コンテキスト構成（Manifest V3）:
- **Service Worker** (`src/background/`) — コマンドルーティング、captureVisibleTab、メッセージ中継
- **Content Script** (`src/content/`) — 選択UI、トースト、クリップボード書き込み。ESモジュール不可のためインライン定義
- **Offscreen Document** (`src/offscreen/`) — ONNX Runtime Web をWeb Workerで実行

追加ページ:
- **Viewer** (`src/viewer/`) — ローカル画像をCanvas上で開いてOCR。ファイル選択/D&D/Ctrl+V貼り付け対応
- **Options** (`src/options/`) — クリーニングルール編集、設定

## OCRパイプライン

1. DEIM — テキスト領域検出（1024×1024入力）
2. NDL Parser — 検出結果を構造化ツリーに変換
3. XY-Cut — 読み順解析（縦書き右→左 / 横書き左→右を自動判定）
4. PARSeq — 文字認識（768×32入力、縦書きは90度回転）

## パディング

タイトな範囲選択でもOCRが動くよう、クロップ後に隣接色パディングを追加。
- `src/ocr/engine/padding.ts` — calcPadding（短辺の30%、最大50px）
- `src/offscreen/offscreen.ts` — cropScreenshot内で端ピクセル引き伸ばし
- 白背景でも暗背景でも対応（白パディングは暗背景で検出失敗するため隣接色方式）

## 共通モジュール

- `src/shared/cleaning.ts` — CleaningRule型、loadRules、saveRules、applyCleaningRules
- `src/shared/settings.ts` — Settings型、loadSettings、saveSettings
- `src/shared/messages.ts` — メッセージ型定義

Content Scriptはインライン定義（ESモジュール不可）。Viewer/Optionsは共通モジュールをimport。

## テスト

vitest使用。ブラウザAPI非依存の純粋ロジック + onnxruntime-nodeによるOCR統合テスト。

- `src/ocr/parser/__tests__/` — ndl-parser
- `src/ocr/reading-order/__tests__/` — xy-cut、reorder、smooth-order、warichu、eval
- `src/shared/__tests__/` — cleaning
- `src/ocr/engine/__tests__/` — tensor-utils、padding
- `src/ocr/__tests__/` — OCR統合テスト（onnxruntime-node + sharp、実モデル使用）

統合テストではテスト画像をsharpのSVGから動的生成。fixtures/にサンプル画像あり。

## ストア素材 (store/)

すべてHTML + CSSで作成し、Playwrightでキャプチャ/録画。

- `screenshots.html` — スクリーンショット5枚（data-lang-ja/en切替、レスポンシブ対応）
- `promo-tiles.html` — 小タイル(440×280) + マーキー(1400×560)
- `privacy-policy.html` — プライバシーポリシー（GitHub Pagesでデプロイ）
- `video/scene*.html` — プロモ動画シーン（CSSアニメーション）
- `video/screenshot.mjs` — Playwrightでスクショ+タイル自動キャプチャ
- `video/build-video.mjs` — 録画+音声生成+結合（--lang ja/en対応）
- `video/generate-voice.mjs` — VOICEVOXナレーション生成
- `video/merge.sh` — ffmpegクロスフェード合成

キャプチャ時の注意:
- `deviceScaleFactor: 1` を必ず指定（Retinaで2倍サイズ防止）
- レスポンシブHTMLでもキャプチャ時はJS で固定サイズに強制
- `.top-bar`（言語切替+GitHubリンク）はキャプチャ時に非表示

## SNS動画 (social/)

ショート動画（TikTok/YouTube Shorts/Instagram Reels）用。縦型1080×1920。

構成: HTMLイントロ → 実写デモ → HTMLアウトロ

- `social/card-demo/` — カードOCRデモ動画
  - `intro.html` / `outro.html` — 演出付きHTML（バウンス、パルスリング等）
  - `card-demo.mov` — 実写素材
  - `generate-card-voice.mjs` — VOICEVOXナレーション（あいえるたん、speedScale:1.15、intonationScale:1.3）
  - `build.mjs` — Playwright録画 + ffmpegリサイズ(1.2倍速) + 結合
  - `subtitles.srt` — デモ部分のみテロップ（イントロ/アウトロは不要）

テロップ焼き込み: ffmpeg subtitlesフィルター使用（ffmpeg-fullが必要、`brew install ffmpeg-full`）

ナレーションタイミング調整の手順:
1. VOICEVOXで生成して発話秒数を計測
2. 実写動画のフレーム分析でシーン切替時刻を特定
3. イントロ秒数をオフセットとして加算
4. 被りチェックスクリプトで自動検証

## 記事 (articles/)

- `01-offline-ocr-introduction.md` — 拡張機能の紹介（Zenn）
- `02-store-listing-with-html.md` — ストア素材をHTML+CSSで自動化（Zenn）

## 権限

- scripting — コンテンツスクリプト注入
- offscreen — ONNX Runtime Web実行
- clipboardRead — クリップボードの画像読み取り（ビューアー用）
- clipboardWrite — OCR結果のコピー
- contextMenus — 右クリックメニュー
- storage — クリーニングルール・設定の保存
- host_permissions `<all_urls>` — 任意ページでのスクリーンショット・スクリプト注入
- activeTabは不要（host_permissionsでカバー）

## コミットルール

- 日本語でコミットメッセージ
- socialフォルダはコミットに含めない（明示的に指定されない限り）
- Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

## VOICEVOX

- ナレーション: あいえるたん（Speaker ID: 68）
- 動画で使用する場合はクレジット表記が必要
- 英語ナレーションはVOICEVOXでは不自然になるため、英語版は字幕のみ推奨
