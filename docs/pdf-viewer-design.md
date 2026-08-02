# PDF Viewer / OCR 対応 設計書

- 作成: 2026-08-02
- ステータス: **Draft** (レビュー中)
- 関連: [strategy-2026-06.md](strategy-2026-06.md) の P1 「PDF直接OCR (v0.8)」

## 1. 概要

オフラインOCR拡張にローカル PDF ファイルの読み込みと OCR 対応を追加する。
既存の Image Viewer を拡張し、PDF の各ページを画像として扱えるようにする。

**大枠のユーザー体験:**

1. popup の「PDFを開く」ボタンを押す
2. 新しいタブで viewer.html が開く (PDF モード)
3. ローカルの PDF を選ぶ
4. 最初のページが表示される + ページナビ (`< 3 / 24 >`)
5. 現在のページに対して既存の選択範囲 OCR / 全体 OCR が動く
6. 前/次ボタンでページを移動、同じフローを繰り返す

## 2. スコープ

### 2.1 In scope (この設計で対応する範囲)

- ローカル PDF ファイル (パスワードなし) の読み込み
- ページごとに表示、任意ページで既存の選択 / OCR フロー再利用
- popup にエントリー、viewer に PDF モード追加
- パスワード付き PDF・不正な PDF に対する明確なエラー

### 2.2 Out of scope (このプロジェクトではやらない)

- **パスワード付き PDF の解読 / パスワード入力 UI**
- **PDF のテキストレイヤーを利用したテキスト直接抽出** (常に OCR で処理する。Phase 3 で検討)
- **全ページの一括 OCR / バッチ処理** (Phase 3)
- **右クリック連携** (Web ページ上の PDF リンクを右クリック→開く) — 明示的に不要と決定
- **ページ回転検出 / 白紙ページスキップ / OCR済みキャッシュ** — 将来検討
- **編集した PDF の書き出し** — 読み取り専用

## 3. 要件

### 3.1 機能要件

| ID | 要件 |
|---|---|
| FR1 | popup に「PDFを開く」ボタンを追加 |
| FR2 | viewer.html でローカル PDF ファイルを開ける (file picker) |
| FR3 | PDF のページ間を移動できる (前/次 ボタン + ページ番号入力) |
| FR4 | 現在ページ番号 / 総ページ数を常時表示 |
| FR5 | 現在ページに対して既存の選択範囲 OCR / 全体 OCR が動作 |
| FR6 | パスワード付き PDF は日本語エラーメッセージで拒否 |
| FR7 | 不正な PDF (壊れている / PDF でない) も日本語エラーメッセージで拒否 |

### 3.2 非機能要件

| ID | 要件 |
|---|---|
| NFR1 | すべてローカル処理、外部通信は行わない (プライバシー方針の維持) |
| NFR2 | 既存の画像ビューアの体験を変えない (回帰なし) |
| NFR3 | バンドルサイズ増加は 1MB 以下 (`pdfjs-dist` gzip ~500KB) |
| NFR4 | 100 ページの PDF もページ切替が 1 秒以内 (該当ページのみ render) |
| NFR5 | 既存の 126 vitest テスト + 3 E2E テストは全て pass のまま |
| NFR6 | 決定論的: 同一 PDF・同一ページ → 常に同一ピクセル出力 |

## 4. アーキテクチャ

### 4.1 コンテキスト構成 (既存構成の維持)

Manifest V3 の 3 コンテキスト構成は変更しない:

- **Service Worker** (`src/background/`): 変更なし
- **Content Script** (`src/content/`): 変更なし
- **Offscreen Document** (`src/offscreen/`): 変更なし (OCR パイプラインの窓口)

拡張ページ (`viewer.html`, `popup.html`) はそのまま拡張。

### 4.2 新規モジュール

```
src/
  pdf/
    pdf-loader.ts               ← pdfjs-dist の薄いラッパー
    __tests__/
      pdf-loader.test.ts        ← vitest ユニットテスト
      fixtures/
        hello-3page.pdf         ← 通常 PDF (3ページ)
        password-protected.pdf  ← パスワード付き PDF
        generate.mjs            ← フィクスチャ再生成スクリプト
```

### 4.3 変更モジュール

| ファイル | 変更内容 |
|---|---|
| `src/popup/popup.html` + `popup.ts` | 「PDFを開く」ボタン追加 |
| `src/viewer/viewer.html` + `viewer.ts` | PDF ロード対応、ページナビ UI 追加 |
| `vite.config.ts` | 変更なし (viewer は既にエントリ) |
| `public/manifest.json` | 変更なし (viewer は既に web_accessible) |
| `package.json` | `pdfjs-dist` を dependencies に、`pdfkit` を devDependencies に追加 |

### 4.4 データフロー

```
[popup]  "PDFを開く" クリック
   ↓
chrome.tabs.create({ url: "viewer.html?mode=pdf" })
   ↓
[viewer.html]  ?mode=pdf を検出 → PDF file picker を初期表示
   ↓
[viewer.ts]  file 選択 → arrayBuffer
   ↓
[pdf-loader]  loadPdf(bytes) → PdfDocument
   ↓
[viewer.ts]  currentPage = 1 → getPage(1).render() → Blob (PNG)
   ↓
[viewer canvas]  Blob を img として表示 (既存フロー)
   ↓
[selection UI]  既存のドラッグ選択がそのまま動く
   ↓
[OCR]         既存 offscreen document → worker
   ↓
[結果]        クリップボードコピー + 履歴保存 (既存)

              ページナビ操作時:
              currentPage = n → getPage(n).render() → 再描画
```

### 4.5 依存

| パッケージ | 種別 | 用途 |
|---|---|---|
| `pdfjs-dist` | dependencies | PDF 読み込み・レンダリング本体 |
| `pdfkit` | devDependencies | テスト fixture の一度限りの生成用 (production bundle には入らない) |

pdfjs-dist はページ描画時に Web Worker を内部で使う (メインスレッドをブロックしない)。この Worker と既存 OCR Worker は別インスタンスなので競合なし。

## 5. モジュール設計: `src/pdf/pdf-loader.ts`

### 5.1 型定義

```typescript
export class PdfPasswordError extends Error {
  constructor() { super("PDF is password-protected"); this.name = "PdfPasswordError"; }
}
export class PdfLoadError extends Error {
  constructor(message: string) { super(message); this.name = "PdfLoadError"; }
}
export class PdfRenderError extends Error {
  constructor(message: string) { super(message); this.name = "PdfRenderError"; }
}

export type PdfDocument = {
  readonly pageCount: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
};

export type PdfPage = {
  readonly pageNumber: number;
  readonly width: number;   // CSS px at scale=1
  readonly height: number;  // CSS px at scale=1
  render(scale?: number): Promise<Blob>;  // PNG. default scale=1.5
};

export async function loadPdf(
  source: Uint8Array | ArrayBuffer
): Promise<PdfDocument>;
```

### 5.2 契約

- `loadPdf` は文書構造の解析のみ (ページ描画は行わない)。返却は速い
- `getPage(n)` は **1-indexed**、範囲外は `RangeError` を投げる
- `render(scale)` は default `scale=1.5` (Retina 相当)
- **呼び出し順序**: `loadPdf` → 必要な回数 `getPage(n).render()` → 使い終わったら `destroy()`
- **破棄後の呼び出し** (`destroy()` 後の `getPage` / `render`) は `PdfRenderError` を投げる

### 5.3 エラー処理

| クラス | 発生条件 | UI 側のユーザー向けメッセージ (例) |
|---|---|---|
| `PdfPasswordError` | pdfjs の `PasswordException` を検出 | 「パスワード付き PDF は現在サポートしていません」 |
| `PdfLoadError` | PDF 構造が壊れている、または PDF でない | 「PDF ファイルを読み込めませんでした」 |
| `RangeError` | ページ番号が 1..pageCount 範囲外 | (プログラムエラー、ユーザーには出さない想定) |
| `PdfRenderError` | `render` 中に失敗、`destroy` 後の呼び出し | 「ページの描画に失敗しました」 |

**pdfjs 由来のエラーはすべてこの4種類のどれかに正規化する** (pdfjs の内部エラー名を UI 層に漏らさない)。

### 5.4 pdfjs-dist の設定

- worker script: 拡張の `assets/` に同梱 (`import.meta.url` ベースで自動解決、CDN 使用禁止)
- `disableAutoFetch: true` (ローカルファイル前提、ストリーミング不要)
- `disableStream: true` (同上)
- `isEvalSupported: false` (CSP 準拠、eval 禁止)

## 6. 実装フェーズ

### Phase 1: PDF ローダー (本設計書 + 実装 PR)

- 本設計書のコミット
- `pdfjs-dist` / `pdfkit` の追加
- `src/pdf/pdf-loader.ts` の実装
- fixture PDF の生成 + コミット
- `src/pdf/__tests__/pdf-loader.test.ts` の TDD
- 既存の 126 テストが壊れないことを確認

Phase 1 完了時点で UI は変わらないが、ローダーは呼び出し可能な状態。

### Phase 2: viewer / popup UI (次 PR)

- `viewer.html` を PDF モード対応に拡張
  - `?mode=pdf` クエリで PDF file picker を初期表示
  - PDF ロード時にページナビ UI を出す
  - ページ切替で `pdf-loader.render()` を呼んで canvas に描画
- popup に「PDFを開く」ボタン追加
- Playwright E2E テスト:
  - PDF ファイルを file input に投入
  - ページ数が正しく表示される
  - 次ページボタンでページが切り替わる
  - 現在ページを OCR してテキストが取得できる
- CHANGELOG / ストア説明の更新は Phase 2 で実施 (機能公開時)

### Phase 3 以降 (将来検討、未確定)

- 全ページ一括 OCR (バッチモード)
- PDF テキストレイヤーの直接抽出 (OCR skip オプション)
- 白紙ページ自動スキップ
- ページ回転検出 / 自動補正
- ページ描画結果の LRU キャッシュ

## 7. テスト戦略

### 7.1 ユニットテスト (Phase 1, vitest, Node)

`src/pdf/__tests__/pdf-loader.test.ts` で以下をカバー:

| # | ケース | 期待 |
|---|---|---|
| T1 | 有効な 3ページ PDF をロード | `pageCount === 3` |
| T2 | `getPage(1)` | `PdfPage` オブジェクト返却、`pageNumber === 1` |
| T3 | `getPage(0)` / `getPage(4)` | `RangeError` throw |
| T4 | パスワード付き PDF をロード | `PdfPasswordError` throw |
| T5 | デタラメなバイト列 (`Uint8Array.from([1,2,3])`) | `PdfLoadError` throw |
| T6 | `destroy()` 後に `getPage(1)` | `PdfRenderError` throw |
| T7 | `getPage(n).width / height` | 正の数値、fixture の想定サイズと一致 |

**`render()` の pixel 出力テストは Node では扱いづらい** (Canvas 依存)。ローダーの構造・エラー分岐だけ Node で。実描画は Phase 2 の Playwright E2E に回す。

### 7.2 統合テスト (Phase 2, Playwright)

- viewer.html を PDF モードで開く
- fixture PDF をファイル入力に投入
- ページ数表示が正しい
- 次ページボタンでページが切り替わる
- 現在ページを OCR してテキストが取得できる (既存 E2E ハーネス活用)

### 7.3 手動確認 (Phase 2)

- 実際の PDF (論文、レシート、行政文書 等) で動作確認
- パスワード付き PDF でエラー表示が出るか
- 大きな PDF (100 ページ超) でメモリリーク / パフォーマンス問題がないか

## 8. 代替案の検討

### 案A: PDF 専用ページ `pdf.html` を新設 [棄却]

- Pro: 責務が完全分離
- Con: 選択 UI、OCR 呼び出し、履歴保存の全ロジックを重複実装 (DRY 違反)
- 判断: viewer を拡張する方が良い

### 案B: pdfjs の完成品 `viewer.js` をそのまま埋め込み [棄却]

- Pro: ページナビ・ズーム・検索など豊富な UI が最初から使える
- Con: CSP 制約、UI カスタマイズ困難、既存の選択 UI との統合が難しい
- 判断: pdfjs は低レベル API (`getDocument` / `getPage` / `render`) だけを使い、UI は自前

### 案C: `pdfjs-dist` ではなく MuPDF WASM [棄却]

- Pro: レンダリング高速、ライセンス選択可
- Con: WASM サイズが大きい (~3MB)、Chrome extension 実績少ない
- 判断: pdfjs-dist は Mozilla 実装で実績十分、コミュニティ規模も大きい

### 案D: PDF テキストレイヤーがある場合は OCR skip [Phase 3 に延期]

- Pro: 通常の PDF は瞬時にテキスト取得できる、CPU 節約
- Con: 「OCR してるつもりが違う挙動」というユーザー期待とのズレ、UX 設計が必要
- 判断: Phase 1-2 は「常に OCR する」で統一。Phase 3 で「テキストがある場合は先に提案」UI を検討

## 9. Open Questions (レビューで確認したい点)

| # | 質問 | 現時点の私の案 |
|---|---|---|
| Q1 | fixture 生成スクリプトはコミットする / しない? | **コミットする** (再生成手順を残す) |
| Q2 | Phase 1 で DnD (viewer 画面に PDF をドラッグ) にも対応する? | **Phase 2 に回す** (Phase 1 は file picker のみ) |
| Q3 | Ctrl+V (クリップボード PDF) 対応は? | **対応しない** (PDF は clipboard に乗らないため) |
| Q4 | render のデフォルト scale はいくつがいい? | **1.5** (Retina 相当、OCR 精度と速度のバランス) |
| Q5 | ページ切替時に直近 N ページを cache する? | **Phase 3 に回す** (Phase 1-2 は毎回 render) |
| Q6 | Phase 1 と Phase 2 は別 PR にする? 1 PR にする? | **別 PR** (ローダーの契約を先に固める) |

## 10. リスクと緩和策

| リスク | 緩和策 |
|---|---|
| pdfjs Worker が既存 OCR Worker と競合してメモリ枯渇 | ドキュメント使用完了時に必ず `destroy()`、viewer 破棄時に自動 destroy |
| バンドルサイズが想定より膨らむ | Phase 1 完了時に `du -sh dist/` で計測、1MB 超えたら再検討 |
| 大きな PDF でレンダリングがハング | ページ単位で render (全ページ先読みしない)、UI で spinner 表示 |
| pdfjs のバージョン更新で API 変化 | 薄いラッパー層 (`pdf-loader.ts`) を挟んで影響を局所化 |
