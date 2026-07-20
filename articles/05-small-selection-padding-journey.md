---
title: "Chrome拡張OCRの「小さな範囲選択」問題を、パディングのアルゴリズムを何度も直しながら解決してきた話"
emoji: "🧪"
type: "tech"
topics: ["chrome拡張", "ocr", "画像処理", "個人開発", "typescript"]
published: false
---

## はじめに

[Chrome拡張「オフラインOCR」](https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd) を作ってリリースしてから、ずっと引きずってきた課題があります。

**「小さな範囲を選んだときに、うまく文字が取れない」問題** です。

ボタンの文字、コミットハッシュ、リンクの1行 — 「ちょっとだけ選びたい」というケースほど、OCR の内部処理では扱いが難しくなります。今回はその課題を、リリース後の半年間で **パディング（マージン）のアルゴリズム** を何度か作り直しながら少しずつ解決してきた道のりを、実例と検討過程を交えて書き残しておきます。

以前の記事はこちら:

- [作った話（1本目）](https://zenn.dev/lecto/articles/a2ee65243b02b3)
- [ストア素材・動画をHTML+CSSで作った話（2本目）](https://zenn.dev/lecto/articles/3b1606a8ac859e)
- [作って公開してからちょこちょこ直した話（3本目）](https://zenn.dev/lecto/articles/0ff674ad00181f)

## 発端: タイトに選ぶと DEIM が「文字なし」判定してしまう

OCR パイプラインの第1段階は文字領域を検出する **DEIM** です。ここで検出されたボックスを PARSeq に渡して文字認識、というのが基本の流れ。

DEIM は「文字とその周りの余白」をペアで見ることで、初めて「これは文字領域だ」と判断してくれるモデルです。**タイトに囲みすぎて余白がほぼゼロだと、そもそも文字と認識してくれない** ことがあります。

たとえば、こういう入力:

![タイトに切り取った短い英数字](/images/05-01-tight-crop.png)

`cfa8b33` という 7 文字を、余白ゼロでピッタリ切り抜いた画像です。この画像を DEIM に投げると、**検出スコアがしきい値未満 → 検出結果ゼロ件 → 空の OCR 結果** が返ってきます。

「短いテキストを選択したのに OCR できなかった」というユーザー体験は、この段階で起きていました。

## 対応その1: 隣接色パディング (v0.2)

対応として、DEIM に渡す前に **選択範囲の外側にパディング（余白）を追加する** ようにしました（v0.2）。

パディングの色は、ただの白や黒だとダメで、**選択範囲の端ピクセルを外側に引き伸ばす** 方式にしています。これを「隣接色パディング」と呼んでいます。

![隣接色パディングを追加した状態](/images/05-02-with-adjacent-padding.png)

- 短辺の 30%（最大 50px）を外側に追加
- 追加された領域は、選択範囲の端の 1 pixel を stretch した色で塗る
- 白背景でも暗背景でも自然に馴染む

これで DEIM が「余白を挟んで文字がある」と正しく認識できるようになり、タイトな選択でも OCR できるようになりました。

## 対応その2: 極小画像は DEIM を飛ばして PARSeq に直接 (v0.6)

しばらくして、こんな声が届きました。

> `cfa8b33` みたいな短いコミットハッシュを選択したけど、パディングを付けても認識されない

デバッグモードで確認したところ、v0.2 のパディングを追加した後でも、**選択範囲があまりに小さい（短辺 200px 未満）と DEIM の検出スコアが上がりきらない** ケースがありました。

そこで v0.6.0 で **「小さい画像は DEIM を飛ばして PARSeq に直接渡す」経路** を追加しました。

- 入力全体を「1 行のテキストだ」と見なす
- アスペクト比を維持したまま、height を PARSeq 入力の 16px に fit
- 余りの width を右側にパディングで埋める

![PARSeq 入力の見た目：左が本文、右がパディング](/images/05-03-parseq-input.png)

このアプローチで、v0.2 では取りきれなかった極小画像（ボタン文字・短い英数字）も認識できるようになりました。

## 発生した問題: パディングが「隣接行の断片」を引き伸ばしてノイズ化

ここで一段落かと思いきや、v0.6 のリリース後にまた症状が出ました。

**特定の 1 行を選んだつもりが、上下に隣接行の文字断片が数ピクセルだけ写り込んで、それがパディングで縦に引き延ばされてノイズになる。**

隣接色パディング（v0.2）は「端の 1 pixel を stretch する」実装なので、その 1 pixel に断片ピクセル（白の文字色）が含まれていると、パディング領域が **縦に長い白いストリップ** で埋まります。

これを PARSeq に投げると、その縦線を「1」や「|」として順に読み出してしまい、`cfa8b33 1111111...` みたいな出力になる。

再現用にこういう fixture を作ってみました:

![上下に隣接行の断片、中央に本命](/images/05-04-fragments-fixture.png)

- 上端に「日本花子 サンプル」の下端が数ピクセル
- 中央に本命の `cfa8b33`
- 下端に「2026年 個人開発」の上端が数ピクセル

この画像に v0.2 の隣接色パディングをそのまま当てると、こうなります:

![断片ピクセルが縦に引き延ばされて padding にストリップとして残る](/images/05-05-padded-with-fragments.png)

赤い破線が元の crop 領域で、その外側が padding。**下端の「2026年 個人開発」の一部が縦に引き延ばされて、下 padding に明るい縦ストリップとして残っている**のがわかります。上端も同様に「日本花子 サンプル」の残骸が薄く伸びています。この縦ストリップを PARSeq が縦線 (`1` や `|`) として読み出すので、結果に余計な文字がくっついてくる、というのが直接の原因でした。

実際、この画像を修正前のパイプラインに投げると、認識結果は `(10 (198` — 本命の文字は消え、断片から作られた別文字が返ります。

## 対応その3-①: パディング色を「多数派」から取る

原因はふたつに分解できます。

**(a) パディング色を「1 pixel 見て決めている」ので、断片ピクセルを引いてしまう**

そこで **枠全体を集計して、面積割合の一番大きい色を採用する** 方式に変えました。

![上下左右の枠を全部サンプリングして多数派の色を採用](/images/05-06-border-sampling.png)

上下左右の border 全体（黄色くハイライトした部分）を全部サンプリングして、色を 16 段階に量子化し、一番票が多いバケットの色をパディング色として使う。断片ピクセルが数個混じっていても、大部分を占める背景色が選ばれます。

コードにするとこんな感じ:

```typescript
export function dominantBorderColor(src: ImageData) {
  const { data, width, height } = src;
  const buckets = new Map<string, number>();
  const bin = (v: number) => v >> 4; // 16-level quantization per channel
  const bump = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const key = `${bin(data[i])}-${bin(data[i + 1])}-${bin(data[i + 2])}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  };
  // 上端・下端の行
  for (let x = 0; x < width; x++) {
    bump(x, 0);
    bump(x, height - 1);
  }
  // 左端・右端の列
  for (let y = 0; y < height; y++) {
    bump(0, y);
    bump(width - 1, y);
  }
  // 一番票が多かった色を返す
  let bestKey = "0-0-0";
  let bestCount = 0;
  for (const [k, c] of buckets) if (c > bestCount) { bestCount = c; bestKey = k; }
  const [rq, gq, bq] = bestKey.split("-").map(Number);
  return { r: (rq << 4) | 8, g: (gq << 4) | 8, b: (bq << 4) | 8 };
}
```

## 対応その3-②: 本文行を「インク帯」で抽出する

**(b) sharp の `trim()` では断片が入った行を残してしまう**

trim() は「連続する uniform な bg 行」を境界から削っていく実装なので、行の途中に断片ピクセルが 1 つでもあると、その行は残ります。断片が上下端に少しでもあると、実質的に何もクロップされない。

そこで **「行ごとの非背景ピクセル数」プロファイル** を作って、連続する ink 行の中で **最大の高さを持つ帯** を本文行として抽出することにしました。

![行ごとのインク量プロファイル。緑が本文行、黄が弾かれる断片](/images/05-07-ink-profile.png)

- 行ごとに「dominant color から離れたピクセル」の数をカウント
- 連続する ink > 0 の帯を全部拾い出す
- その中で最も高さがある帯を「本文行」とみなす
- 上下の断片は「細い帯」として自動的に弾かれる

コード（要点だけ）:

```typescript
export function extractMainTextBand(
  src: ImageData,
  bg?: { r: number; g: number; b: number },
  threshold: number = 40,
): ImageData {
  const cbg = bg ?? dominantBorderColor(src);
  const th2 = threshold * threshold;

  // 各行の "非背景ピクセル数" をカウント
  const rowInk = new Uint32Array(src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4;
      const dr = src.data[i] - cbg.r;
      const dg = src.data[i + 1] - cbg.g;
      const db = src.data[i + 2] - cbg.b;
      if (dr * dr + dg * dg + db * db > th2) rowInk[y]++;
    }
  }

  // 連続する ink 帯を集計、最大 height を本文行として採用
  const bands: { start: number; end: number }[] = [];
  let start = -1;
  for (let y = 0; y <= src.height; y++) {
    const inkOn = y < src.height && rowInk[y] > 0;
    if (inkOn) {
      if (start === -1) start = y;
    } else if (start !== -1) {
      bands.push({ start, end: y });
      start = -1;
    }
  }
  if (bands.length === 0) return src;
  const main = bands.reduce(
    (max, b) => (b.end - b.start > max.end - max.start ? b : max),
    bands[0],
  );
  return cropImageData(src, 0, main.start, src.width, main.end - main.start);
}
```

## 修正後

さっきの fixture:

![](/images/05-04-fragments-fixture.png)

の認識結果が **`cfa8b33` にちゃんと戻りました**。TDD で書いた回帰テストも緑、既存の 125 テストにも回帰なし。

## 振り返り

半年間で 3 段構えで直してきたことになります:

| 時期 | 課題 | 対応 |
|---|---|---|
| v0.2 | タイトに選ぶと DEIM が反応しない | 端ピクセルを stretch した隣接色パディングを追加 |
| v0.6 | パディングしても極小画像は DEIM が反応しない | 短辺 ≤ 200px の画像は DEIM を飛ばして PARSeq に直接渡す |
| 次期リリース | 隣接行の断片がパディングに混ざってノイズ化 | dominant border color + 本文行の帯抽出 |

**選択範囲を小さくすればするほど、選択者が本当に見せたい部分と「たまたま端に写り込んだ情報」の判別が難しくなる。** 10 文字の選択なら、そのうち 1〜2 pixel の断片が混じるだけで、認識結果が壊れる可能性がある。パディングみたいな地味な処理が、実は認識精度に大きく効いてくるのが面白いところ。

TDD で fixture を作って再現 → 直す、というサイクルが機能したのも、こういう「認識アルゴリズムの副作用」を追いかけるのに向いていました。ちょっと直した拍子に他のケースが壊れる、というのが起きにくい。

## おわりに

課題駆動でパディング1つを何度も直してきた話でした。ユーザー報告や動画作りで見つかった不具合が、そのまま次の設計改善のヒントになっていく感じは、個人開発でも本業でも変わらないなと感じます。

次回のリリース (v0.7.1 予定) に含めて公開します。もし触ってみていただけたら嬉しいです:

https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd

https://github.com/tamoco-mocomoco/offline-ocr

「小さく切っても、ちゃんと取れる」を積み上げていきます。
