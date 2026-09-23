---
title: "Chrome拡張のオフラインOCRで、ローカルPDFを"直接開いて"OCRできるようにした話"
emoji: "📄"
type: "tech"
topics: ["chrome拡張", "ocr", "pdf", "個人開発", "typescript"]
published: false
---

## はじめに

[Chrome拡張「オフラインOCR」](https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd) の v0.8.0 で、**ローカルの PDF ファイルを直接開いて OCR できる**ようにしました。

これまでは PDF を扱うのに一度スクショを撮ったり、専用のツールを挟んだりと迂回が必要でした。特に「ローカルに置いてあるスキャン PDF (領収書・行政文書・古い書類など) を手軽に文字起こししたい」という声が多かったのですが、Chrome 拡張の権限モデル的にこれは意外と壁があります。

今回はその壁の正体と、それを回避する形で PDF に対応した話をまとめます。

以前の記事はこちら:

- [作った話 (1本目)](https://zenn.dev/lecto/articles/a2ee65243b02b3)
- [ストア素材・動画を HTML+CSS で作った話 (2本目)](https://zenn.dev/lecto/articles/3b1606a8ac859e)
- [作って公開してからちょこちょこ直した話 (3本目)](https://zenn.dev/lecto/articles/0ff674ad00181f)
- [プロモ動画を作った話 (4本目)](https://zenn.dev/lecto/articles/f1b0f0b0f0b0f0)
- [「小さな範囲選択」問題とパディング (5本目)](https://zenn.dev/lecto/articles/small-selection-padding-journey)

https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd

https://github.com/tamoco-mocomoco/offline-ocr

## なぜ今までできなかったのか — Chrome 拡張の制約

PDF 対応が難しかった理由は主に3つあります。

### 1. `file://` プロトコルへのアクセスに壁がある

Chrome 拡張は、デフォルトでは `file://` (ローカルファイル) にアクセスできません。ユーザーが `chrome://extensions/` の詳細画面から明示的に「ファイル URL へのアクセスを許可する」を ON にしないといけない。

この設定は目立たないですし、そもそもオフをオンに切り替える説明を毎回するのはしんどい。**「ローカル PDF をドラッグすれば動きます」と気軽に言えない**のが第一の壁でした。

![Chrome拡張のfile://アクセス設定は明示的なオプトインが必要](/images/06-01-file-access-restriction.png)

### 2. Chrome の内蔵 PDF ビューアには拡張スクリプトを注入できない

Chrome は `.pdf` ファイルを開くと内蔵ビューアで表示します。ここは PDFium という別プロセスで動いていて、**Content Script を注入できません** (今回のOCR拡張がやっている範囲選択の仕組みが動かない)。

つまり「開いた PDF をそのまま右クリック → OCR」というブラウザ拡張の得意技が、PDF に対しては素直に使えない。

### 3. ブラウザ内で PDF を描画する仕組みを別途持ち込む必要がある

「拡張機能側で PDF を読み込んで、自前で描画して、その画像を OCR に流す」という設計にすれば上の2つを回避できます。ただそのためには **ブラウザ内で PDF を pixel まで描画するライブラリ** を同梱する必要があります。

幸い、Mozilla の [pdfjs-dist](https://mozilla.github.io/pdf.js/) がまさにこれ用のライブラリで、Chrome 拡張の Content Security Policy (CSP) にも対応可能な形になっています。ただしバンドルサイズが 2〜3MB 増えるので、既存ユーザーへの影響を計算する必要はありました。

## 今回の設計 — image viewer に PDF モードを乗せる

「専用の PDF ページを作る」と「既存の image viewer を拡張する」で迷いましたが、**既存 viewer を拡張して PDF もそこで開く**方式にしました。理由は:

- 選択範囲 OCR / 全体 OCR / OCR履歴 / クリーニングルール といった **既存のフローがそのまま流用できる**
- ページ切替の UI だけ追加すれば済むので、コードの重複がない
- ユーザーから見ても「同じ画面で画像も PDF も扱える」で認知負荷が低い

![popup に「PDFを開く」ボタンを追加、viewer にページナビを追加](/images/06-02-popup-and-viewer.png)

Popup に **「PDFを開く」** ボタンを追加、viewer 側には **前/次ページのナビゲーション** と **ページ番号インジケータ** を追加しました。「範囲選択を開始」「画像全体をOCR」といった既存ボタンは、そのままいまページに対して動きます。

## 処理フロー — 全部ブラウザ内で完結

「オフライン OCR」の名前通り、PDF 対応後も **通信ゼロの方針は維持**しています。

```
[popup]  「PDFを開く」クリック
   ↓
[viewer.html?mode=pdf]  新しいタブで開く
   ↓
[pdfjs-dist]  ローカル PDF をパース → 各ページを Canvas に描画
   ↓
[viewer]  ページ移動 UI で任意ページを表示
   ↓
[既存の選択 UI]  ドラッグで範囲選択 (または画像全体 OCR)
   ↓
[offscreen document → OCR Worker]  DEIM で文字領域検出 → PARSeq で認識
   ↓
[結果]  クリップボードにコピー + OCR履歴に "filename.pdf#p3" 形式で記録
```

**pdfjs-dist もモデルファイルも全部拡張本体に同梱**しているので、PDF を開いても Web 上のどこにもアクセスしません。Chrome の DevTools の Network タブで通信ゼロを確認できます。

## 実装で工夫したところ

### 設計書を先に書いた

いきなり実装せず、まず [設計書](https://github.com/tamoco-mocomoco/offline-ocr/blob/main/docs/pdf-viewer-design.md) を書きました。

- **In scope / Out of scope の明示** — パスワード付き PDF、テキストレイヤ抽出、バッチ OCR、右クリック連携 は明示的に対象外に
- **モジュール契約を先に固める** — `loadPdf(bytes) → PdfDocument` のインタフェースを最初に決めて、pdfjs 内部エラーを 3 つのクラス (PdfPasswordError / PdfLoadError / PdfRenderError) に正規化することで UI 層が扱いやすい形にする
- **Phase 1: ローダー / Phase 2: UI** の分割 — ローダーは vitest の Node ユニットテスト、UI は Playwright の E2E で分離してテスト

これのおかげで、実装は迷わず一気通貫で進みました。

### TDD で loader を先に作る

`src/pdf/pdf-loader.ts` は pdfjs-dist の薄いラッパー層です。

```typescript
export async function loadPdf(
  source: Uint8Array | ArrayBuffer,
): Promise<PdfDocument>;

export type PdfDocument = {
  readonly pageCount: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
};

export type PdfPage = {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  render(scale?: number): Promise<Blob>; // PNG
};
```

契約が明確なので、テストが先に書けます。8個の失敗テストを先に書いてから実装した:

1. 3ページ PDF をロードして `pageCount === 3`
2. `getPage(2)` で正しい pageNumber
3. `getPage(0)` / `getPage(4)` は `RangeError`
4. パスワード付き PDF は `PdfPasswordError`
5. デタラメなバイト列は `PdfLoadError`
6. `destroy()` 後の呼び出しは `PdfRenderError`
7. ArrayBuffer 入力にも対応 (viewer からの ArrayBuffer を想定)

フィクスチャの PDF は [pdfkit](https://pdfkit.org/) で1回生成してコミット (`src/pdf/__tests__/fixtures/`)。テストのたびに生成する必要がなく決定的。

**vitest では実際の描画までは検証できません** (Canvas が要る)。この部分は Playwright の E2E に分離しています。

### Playwright E2E で描画まで検証

`test/e2e/pdf.spec.ts` に、Chromium 上で実際にレンダリングして検証するテストを追加:

- 3ページ PDF をロード → pageCount 一致
- `renderPage(1)` の戻り値が **有効な PNG シグネチャ** で始まる非空 Blob
- **異なるページの描画結果が byte 単位で異なる** (キャッシュ間違いや共有バグの検出)

vitest 側と E2E 側を役割分担することで、ローダーの契約と実描画の両方を、それぞれ最も速い環境でテストできます。

### バンドルサイズは +2.3MB (pdfjs の worker)

pdfjs-dist は Web Worker で動く設計です。Vite が `?url` インポートで worker チャンクを別ファイルに切り出してくれるので、PDF を開かない限りロードされません。

```typescript
// dist/assets/pdf.worker-<hash>.mjs  (2.3 MB, PDF を開いた時だけ読み込み)
import PdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
```

zip 化した拡張パッケージのサイズは v0.7.1 と同じ 72MB のまま (モデルファイル 80MB があるので誤差レベル)。

## 使い方

1. Chrome Web Store から「オフラインOCR」をインストール (または更新)
2. ツールバーアイコンをクリック → **「PDFを開く」**
3. ローカル PDF を選択
4. viewer が開いて最初のページを表示
5. 前/次ボタン (または ← / → キー) でページ移動
6. 認識したい範囲をドラッグ、または「画像全体をOCR」
7. 結果がクリップボードにコピー + OCR履歴に `filename.pdf#p2` 形式で残る

![使い方: popup → PDF選択 → viewerでページOCR](/images/06-03-usage-flow.png)

## いまできないこと (次回以降)

正直に書いておきます。

- **パスワード付き PDF** — 拒否してエラー表示。パスワード入力 UI は未対応
- **全ページ一括 OCR** — 今はページごとの手動 OCR。バッチモードは Phase 3 で検討中
- **テキストレイヤーの直接抽出** — Word / Google Docs 等から書き出した通常の PDF はテキストレイヤーを持っているので、OCR を通さず一瞬で取れるはずですが、現在は常に OCR しています。「テキストがある場合は先に提案」UI を検討中
- **ページ回転自動補正 / 白紙ページスキップ** — バッチ実装時に一緒に検討

## 振り返り

「Chrome 拡張から PDF を扱う」ってシンプルに聞こえるんですが、実際には **拡張のセキュリティモデルとブラウザの内蔵 PDF ビューアの都合をかいくぐる**必要があって、意外と設計判断が多かったです。

- **どこに壁があるか、を先に洗い出す**のが結果的に効きました。「なぜ普通のやり方ではダメか」を設計書に書き出したことで、「じゃあ pdfjs-dist を同梱してブラウザ内完結でやる」という方針が自然に導けた
- **既存のフローを壊さない**ことに神経を使いました。image viewer に PDF モードを "追加" する形で、画像 OCR ユーザーの体験は 100% そのまま
- **通信ゼロの方針は絶対に維持**。pdfjs-dist の worker も自分で同梱、Web からのフォント取得なども全部潰す

同じような「拡張機能で PDF を扱いたいけど権限とか描画をどうする問題」に当たっている人の参考になれば嬉しいです。

## おわりに

次回リリース (v0.8.1 予定) では、多行ページの OCR 高速化と暗背景のリンクチップの認識精度改善を入れる予定です。

もし触ってみていただけたら嬉しいです:

https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd

https://github.com/tamoco-mocomoco/offline-ocr

「**手元の PDF を、通信ゼロで、その場で読める**」を積み上げていきます。
