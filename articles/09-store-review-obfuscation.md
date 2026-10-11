---
title: "Chrome拡張がストア審査で「難読化」と判定された — 犯人は pdf.js の legacy 版に入っていた core-js だった話"
emoji: "🔍"
type: "tech"
topics: ["chrome拡張", "typescript", "個人開発", "pdf", "ocr"]
published: false
---

:::message
**この記事について**: 否認された v0.9.0 の内容に、ここで書く対応と新機能（消しゴム）を加えた **v0.9.1 を再申請中**で、審査待ちの状態です。手元の zip では動作確認済みです。
:::

## はじめに

[Chrome拡張「オフラインOCR」](https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd) の v0.9.0（斜めに撮った紙面を平面化してから OCR する「ゆがみ補正で選択」を足したバージョン）を Chrome ウェブストアに申請したところ、**否認されました**。理由は「難読化されたコードがパッケージにある」。

自分では難読化なんてした覚えがありません。調べてみると、指摘されたのは **PDF 表示に使っている pdf.js の「legacy 版」に同梱されていた core-js（古いブラウザ向けの互換コード）** でした。しかも同じコードは、PDF に対応した v0.8.0 からずっと入っていて、v0.8.0 と v0.8.1 の審査は普通に通っています。

この記事では、否認の内容と原因の特定、どう直したか（そして直したことで何を引き換えにしたか）、次から同じことで止まらないために申請前にやるようにしたことをまとめます。

以前の記事はこちら:

- [作った話 (1本目)](https://zenn.dev/lecto/articles/a2ee65243b02b3)
- [ストア素材・動画を HTML+CSS で作った話 (2本目)](https://zenn.dev/lecto/articles/3b1606a8ac859e)
- [作って公開してからちょこちょこ直した話 (3本目)](https://zenn.dev/lecto/articles/0ff674ad00181f)
- [OCR の使い道を動画にしている話 (4本目)](https://zenn.dev/lecto/articles/7a9398c0cbbb04)
- [「小さな範囲選択」問題とパディング (5本目)](https://zenn.dev/lecto/articles/906ae414782f6c)
- [PDF対応にした話 (6本目)](https://zenn.dev/lecto/articles/1a200a115b8299)
- [OCR並列化と品質崩壊 (7本目)](https://zenn.dev/lecto/articles/b6bde2226c68d8)
- [斜めから撮った紙面もOCRしたい — 透視変換UI (8本目)](https://zenn.dev/lecto/articles/ab7cb80fab55cc)

https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd

https://github.com/tamoco-mocomoco/offline-ocr

## 届いた否認の内容

届いたメールの要点はこうでした。

- 違反: **コードの読みやすさの要件**
- 違反の参照 ID: **Red Titanium**（[トラブルシューティングのページ](https://developer.chrome.com/docs/webstore/troubleshooting/#obfuscation)に説明あり）
- 違反事項: 難読化されたコードがパッケージにある
- 違反コンテンツ: コードスニペット 2 件

指摘された 2 か所は、ビルド後の `assets/pdf.worker-*.mjs` と `assets/viewer-*.js` でした。1 つ目（こちらは圧縮されていない）を抜粋するとこんな感じです。

```js
var GT = '>'; var LT = '<'; var PROTOTYPE = 'prototype'; var SCRIPT = 'script';
var IE_PROTO = sharedKey('IE_PROTO');
var scriptTag = function(content) { return LT + SCRIPT + GT + content + LT + '/' + SCRIPT + GT; };
var iframe = documentCreateElement('iframe');
var JS = 'java' + SCRIPT + ':';
// ...
iframeDocument.write(scriptTag('document.F=Object'));
```

2 つ目の `viewer-*.js` は、同じ処理が Vite で圧縮されて `h = ">", d = "<", f = "script"` のようになったものでした。

Red Titanium の説明ページでは、禁止されている難読化の例として **Base64 にした文字列** や **文字コードでエスケープした文字列** が挙げられています。一方で、空白やコメントの削除・変数名の短縮・ファイルの結合といった **minify（圧縮）は許可されています**。今回のコードは `'java' + SCRIPT + ':'` のように**文字列を分割してつなぎ直している**ので、「`javascript:` や `<script>` を隠そうとしている」ように見えた、ということだと思います。

## 正体は core-js の古い IE 向けコード

`IE_PROTO` で検索すると、このコードは [core-js](https://github.com/zloirock/core-js) の `Object.create` の互換実装の一部でした。`Object.create` が無い古い IE で「プロトタイプを持たないオブジェクト」を作るために、`javascript:` を src にした iframe を作り、その中に `<script>document.F=Object</script>` を書き込んで、別の世界の `Object` を借りてくる、という処理です。

文字列を分割しているのも隠すためではありません。`'</' + 'script>'` のような書き方は、このコードが HTML の `<script>` タグ内に埋め込まれたときに、ブラウザが途中の `</script>` をタグの終わりと勘違いしないようにする昔ながらの書き方です。`'java' + SCRIPT + ':'` のほうも、おそらく `javascript:` という URL を検出する静的解析ツールに引っかからないようにするためでしょう。

つまり悪意のあるコードではないのですが、**見た目はまさに「文字列をバラして隠している」コード**です。審査で引っかかるのも無理はありません。

## なぜ core-js が入っていたのか

オフラインOCR は v0.8.0 で PDF に対応したとき、[pdf.js](https://github.com/mozilla/pdf.js) の npm パッケージ `pdfjs-dist` を同梱しました。`pdfjs-dist` には 2 種類のビルドが入っています。

| ビルド | 中身 | 想定 |
|---|---|---|
| `pdfjs-dist/build/`（通常版） | 新しいブラウザ機能を前提にしたコード | 最新のブラウザ |
| `pdfjs-dist/legacy/build/`（legacy 版） | 通常版 + **core-js などの互換コード** | 古いブラウザや Node.js |

当時は「legacy 版なら Node.js（vitest）のテストでもそのまま動く」という理由で legacy 版を選んでいました。実際、コード中のコメントにもそう書いてあります。

数えてみると、問題の `IE_PROTO` は legacy 版の `pdf.mjs` と `pdf.worker.mjs` にそれぞれ 5 か所ずつ、通常版には 0 か所でした。**Chrome 拡張は Chrome でしか動かないので、IE 向けの互換コードは最初から不要**だったわけです。

![v0.9.0 で否認された構成（legacy 版 + core-js）と、v0.9.1 の構成（通常版 + 対応ブラウザの確認）](/images/09-01-legacy-vs-modern.png)

## どう直すか — 3 つの選択肢

選択肢は 3 つありました。

1. **再審査請求をする**: 「OSS の互換コードで、難読化ではない」と説明する。通る可能性はあるが、時間がかかるうえ、次の申請でまた引っかかるかもしれない
2. **ビルド後のコードから該当部分を削る**: 依存ライブラリのコードを書き換えることになり、壊れやすい。core-js の他の部分も残る
3. **pdf.js を通常版に切り替える**: core-js そのものがなくなる。ただし新しいブラウザが必要になる

v0.8.0 と v0.8.1 は同じコードで審査を通っていたので、「前回通ったから大丈夫」は通用しないことがわかりました。毎回の審査で引っかかる可能性を残すより、**原因のコードをパッケージから無くす** のが確実だと考えて、3 を選びました。

## 通常版の落とし穴: 新しい機能を確認せずに使っている

切り替え自体は import を 2 行変えるだけです。

```diff ts
- import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
- import PdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
+ import * as pdfjsLib from "pdfjs-dist"; // = build/pdf.mjs
+ import PdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
```

ただ、通常版がどのブラウザで動くのかを確かめるため、使っている新しい API を grep してみると、**使えるかどうかを確かめずに呼んでいる API** がいくつもありました（pdfjs-dist 6.2 時点）。

| API | 使える Chrome |
|---|---|
| `Math.sumPrecise` | 147〜 |
| `Map.prototype.getOrInsertComputed` | 145〜 |
| `Uint8Array.fromBase64` / `Promise.try` など | それより前 |

`Float16Array` や `ImageDecoder` のように使える場合だけ使う API もありますし、`Iterator.prototype.join` は pdf.js 自身が補っていました。それでも上の表の API は前提として呼ばれているので、**通常版の pdf.js は Chrome 147 以降でないと動かない** ことになります。

### 拡張全体ではなく、PDF だけを Chrome 147 以降にする

manifest に `minimum_chrome_version: "147"` を書けば話は簡単です。ただそうすると、Chrome 147 より古い環境の人には**画像の OCR まで含めて**アップデートが届かなくなります。PDF 以外の機能は今まで通り Chrome 116 以降で動くので、それはもったいない。

そこで、**PDF を開く直前に必要な機能があるかを確かめて、足りなければ「Chrome を更新してください」と案内する** ことにしました。

```ts:src/pdf/pdf-loader.ts
/** Chrome version the newest API below shipped in, for the user-facing message. */
export const PDF_MIN_CHROME_VERSION = 147;

export function isPdfSupported(): boolean {
  const g = globalThis as unknown as {
    Math: { sumPrecise?: unknown };
    Map: { prototype: { getOrInsertComputed?: unknown } };
    Uint8Array: { fromBase64?: unknown };
    Promise: { try?: unknown };
  };
  return (
    typeof g.Math.sumPrecise === "function" &&
    typeof g.Map.prototype.getOrInsertComputed === "function" &&
    typeof g.Uint8Array.fromBase64 === "function" &&
    typeof g.Promise.try === "function"
  );
}
```

ビューアー側は、PDF を読み込む前にこれを見るだけです。

```ts:src/viewer/viewer.ts
async function loadPdfFile(file: File): Promise<void> {
  if (!isPdfSupported()) {
    const v = String(PDF_MIN_CHROME_VERSION);
    showToast(
      t("viewerPdfUnsupportedBrowser", [v]) ||
        `PDF を開くには Chrome ${v} 以降が必要です。Chrome を更新してください`,
      8000,
    );
    return;
  }
  // ...
}
```

pdf.js の中で `TypeError: Math.sumPrecise is not a function` が出て「なぜか PDF が開けない」となるより、何をすればいいか伝わるほうがいいはずです。

### テストだけは legacy 版のまま

困ったのが vitest です。Node.js（v24）には `Math.sumPrecise` も `getOrInsertComputed` も入っていないので、通常版の pdf.js はテストで動きません。そこで **vitest のときだけ legacy 版に差し替える** ことにしました。

```ts:vite.config.ts
test: {
  // The extension ships pdf.js's modern build, which needs APIs Node lacks
  // (Math.sumPrecise, Map#getOrInsertComputed); unit tests use the legacy
  // build instead. See src/pdf/pdf-loader.ts.
  alias: [
    { find: /^pdfjs-dist$/, replacement: "pdfjs-dist/legacy/build/pdf.mjs" },
  ],
},
```

`"pdfjs-dist"` を文字列で指定すると `pdfjs-dist/build/pdf.worker.mjs` のような前方一致まで置き換わってしまうので、正規表現で完全一致にしています。`test.alias` は vitest にしか効かないので、**拡張機能のパッケージに legacy 版が入ることはありません**。

### 古い Chrome の動きもテストする

「古い Chrome では案内が出る」ことは、Playwright の E2E で `Math.sumPrecise` を消してから PDF を開くことで確かめています。

```ts:test/e2e/viewer-pdf.spec.ts
test("asks to update Chrome when the APIs pdf.js needs are missing", async ({ page }) => {
  await page.addInitScript(() => {
    delete (Math as unknown as { sumPrecise?: unknown }).sumPrecise;
  });
  // ... viewer.html を開いて PDF を読み込ませる
  await expect(page.locator("#toast")).toContainText("Chrome 147");
  await expect(page.locator("#canvas")).toBeHidden();
});
```

あわせて、ビルドした拡張機能を Playwright の Chromium（149）に読み込み、日本語 2 ページの PDF を開いて OCR できることも確かめました。

## 申請前に、パッケージを自分で調べる

今回の反省は「依存ライブラリのコードも、自分の拡張機能の一部として審査される」ことを意識していなかった点です。そこで、zip を作る前に dist の中を**審査で引っかかりそうなパターン**で検索するようにしました。

```bash
# core-js の痕跡、文字列の分割、動的なコード実行
grep -rlE "IE_PROTO|core-js|document\.F=Object" dist/
grep -rnoE "['\"]java['\"] *\+|[^.\w]eval\(|new Function\(" dist/ | head
# 長い Base64 文字列（400 文字以上）
grep -rnoE "[A-Za-z0-9+/]{400,}={0,2}" dist/ | cut -c1-120
```

切り替え後の dist で検索した結果はこうでした。

- core-js の痕跡、文字列分割、`eval` / `new Function` は**ゼロ**
- 長い Base64 が 1 か所: pdf.js の `_loadTestFont` に入っている**小さなテスト用フォント**（デコードすると OpenType の `OTTO` ヘッダーから始まる）。フォントの読み込み完了を確かめるためのデータで、legacy 版にも入っていて今回の指摘には含まれていなかった
- `String.fromCharCode` や `\x00\x01...` のような文字列: pdf.worker の中のフォントや PDF のバイト列の処理

最後の 2 つは中身を確認して、問題ないと判断しました。完全に機械的には判定できませんが、「何が入っているか自分で説明できる状態」にしてから出す、というのが大事だと思っています。

## バージョンの扱い

v0.9.0 は否認されたので、ストアには出ていません。そこで、v0.9.0 の内容（ゆがみ補正で選択）に今回の対応と新機能の消しゴムを加えて **v0.9.1** として再申請しました。ストア上は 0.8.1 から 0.9.1 に一気に上がります。

CHANGELOG とストアのバージョン履歴には v0.9.0 も v0.9.1 もそのまま残し、v0.9.1 の項目に「PDF の表示に使うライブラリを更新。PDF を開くには Chrome 147 以降が必要になりました」と書いています。

## まとめ

- ストア審査で **Red Titanium（難読化）** として否認された。指摘されたのは、pdf.js の **legacy 版に同梱されていた core-js** の古い IE 向けコード
- 文字列を分割する書き方は昔ながらの互換のための書き方だが、**見た目は「隠しているコード」そのもの**
- 同じコードで以前は審査を通っていた。**前回通ったから大丈夫、とは限らない**
- Chrome 拡張なら古いブラウザ向けの互換コードは不要。**pdf.js を通常版に切り替えて**原因ごと取り除いた
- 通常版は新しい API を前提にしているので、**PDF だけ Chrome 147 以降**にして、古い Chrome では更新を案内する。PDF 以外は Chrome 116 以降のまま
- テストは vitest の `test.alias` で legacy 版に差し替え。拡張機能のパッケージには入らない
- 申請前に dist を grep して、**中身を自分で説明できる状態**にしてから出す

## おわりに

v0.9.1 では、この対応と一緒に、ビューアーに**消しゴム**を足しています。はんこや手書きのメモなど、OCR したくない部分を消してから読めるようにする機能です。こちらは別の記事で紹介しています。

https://zenn.dev/lecto/articles/0ff3525cd6e2fa

https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd

https://github.com/tamoco-mocomoco/offline-ocr

依存ライブラリも含めて、自分のパッケージは自分で説明できるように。
