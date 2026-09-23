---
title: "Chrome拡張のOCRを4本並列にしたら、そこから品質崩壊が始まった話 — v0.8.1でやったこと"
emoji: "⚡"
type: "tech"
topics: ["chrome拡張", "ocr", "webassembly", "個人開発", "typescript"]
published: false
---

:::message
**この記事について**: v0.8.1 は現在 Chrome Web Store に申請中で、審査完了を待っている状態です。ストアに反映されるまで数日〜数週間ほどかかる想定なので、記事は先出しで書いています。手元の zip では動作確認済みで、CHANGELOG (JA/EN) とストア説明も更新済みです。
:::

## はじめに

[Chrome拡張「オフラインOCR」](https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd) の v0.8.1 で、**多行ページの OCR を高速化**しました。行数が増えるほど wall-clock が短縮する、素直な最適化です。

……が、実際に触ってもらうと、動作確認の中で「なんか変な文字が出るケースが増えてない?」という指摘が来ました。並列化とは別の潜在バグが表面化したり、対応するうちに副作用でこれまで問題なく動いていた「くり返し系の文章」まで消えてしまったり。

**「速くする」だけなら1本 PR ですが、"品質が崩れないこと" を担保するのに残りの 6 本の PR を積むことになりました**。この記事では並列化の仕組みと、その裏で品質を保つためにやったことを書きます。

以前の記事はこちら:

- [作った話 (1本目)](https://zenn.dev/lecto/articles/a2ee65243b02b3)
- [ストア素材・動画を HTML+CSS で作った話 (2本目)](https://zenn.dev/lecto/articles/3b1606a8ac859e)
- [作って公開してからちょこちょこ直した話 (3本目)](https://zenn.dev/lecto/articles/0ff674ad00181f)
- [プロモ動画の活動報告 (4本目)](https://zenn.dev/lecto/articles/f1b0f0b0f0b0f0)
- [「小さな範囲選択」問題とパディング (5本目)](https://zenn.dev/lecto/articles/small-selection-padding-journey)
- [PDF対応にした話 (6本目)](https://zenn.dev/lecto/articles/pdf-ocr-support)

https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd

https://github.com/tamoco-mocomoco/offline-ocr

## 高速化のポイント: PARSeq を worker-pool 化した

### そもそも何が遅いのか

OCR パイプラインは 3 段構成です。

1. **DEIM** — 画像から文字領域 (line) を検出
2. **XY-Cut** — 検出結果を読み順に並べる
3. **PARSeq** — 各 line の画像を文字列にデコード

新聞コラムやレシートのように **line が10行20行と増える**と、支配的なのは PARSeq の推論時間になります。1 行あたり数十〜数百ミリ秒ですが、直列 20 回だと数秒。

### 直列 for ループを worker-pool に

修正前の [ocr.worker.ts](https://github.com/tamoco-mocomoco/offline-ocr/blob/main/src/ocr/worker/ocr.worker.ts) はこうでした:

```typescript
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const lineImg = cropImageData(imageData, x, y, w, h);
  const text = await recognizeLine(lineImg);
  resultLines.push({ text, ... });
}
```

素直な逐次実行。これを **共有インデックスカウンタで next line を pull する worker-pool** に置き換えました。

```typescript
const PARSEQ_CONCURRENCY = 4;
const resultLines = new Array(total);  // idx-based 書き込みで読み順を保つ
let next = 0;

const worker = async (): Promise<void> => {
  while (true) {
    const idx = next++;
    if (idx >= total) return;
    await processLine(idx);   // ← 中で resultLines[idx] = { ... }
  }
};

const workerCount = Math.min(PARSEQ_CONCURRENCY, Math.max(total, 1));
await Promise.all(
  Array.from({ length: workerCount }, () => worker()),
);
```

![line 単位の worker-pool: 逐次 for → 同時 4 本](/images/07-01-worker-pool.png)

### なぜ 4 本なのか

- **メモリ**: ONNX Runtime Web の PARSeq セッションは1回の推論で数十 MB を確保します。同時実行数が増えると WASM ヒープを圧迫する
- **CPU コア**: 現代の Web Worker が使える論理コアは 4〜8 が現実的な下限
- **性能の飽和点**: WASM は内部でシリアライズされるので、4 本超えても比例では速くならない

事前計測で **同時 4 本が体感速度とメモリ消費のちょうど良い折衷** だったので、そこに固定しました。

### 出力順は絶対に崩さない

並列化で怖いのは「認識結果の順番が入れ替わる」こと。読み順解析 (XY-Cut) をせっかく上流でやっているのに、下流で崩したら意味がありません。

対策として **idx-based 書き込み**にしました。

- `resultLines` を `new Array(total)` で先に確保
- 各 worker は自分が担当する `idx` の位置に書き込むだけ (push しない)
- Promise.all で全部終わってから post

つまり、実行順は非決定だけど **格納位置は idx で決まる**ので、順序は保たれます。

### どのくらい速くなったか

多行ページで **wall-clock が実質 1/3 前後** に短縮しました。1〜2 行の短い範囲選択では並列度が 1 なので影響なし。ちょうど「時間がかかっていた大きな OCR」に一番効く形になっています。

## と、ここまでで PR は 1 本のはずでした

並列化の PR を投げて動作確認を頼んだところ、動作確認中に **別の暗背景の chip をOCRしたら `the the the the the...` みたいなゴミが出る**という報告が来ました。

並列化とは無関係。既存の潜在バグが表面化しただけ。**でも v0.8.1 として世に出す前に直したい**。

ここからは「並列化の高速化と品質崩壊防止」の話が半々になります。

## 品質を維持するためにやった 5 つのこと

### 1. CTC ループの後処理除去

PARSeq は CTC ベースのデコーダで、**入力に確信を持てない領域では同じトークンを繰り返して埋める**性質があります。

観察されたパターンは 3 種類:

```
word-level     : the the the the the ... the
char-level     : S.ES.ES.ES.ES.ES.IRES ...
mutation-cluster: CHANGE CHAND CHAND CON R. CON S.IS.EO.IRES ...
```

`.ES` の char-level 反復は空白区切りではないので、単純に単語で split しても掴めません。mutation-cluster は「まったく同じではないけど似た短いトークンの群れ」で、識別さえ厄介。

`src/ocr/engine/tensor-utils.ts` に **3 種類の検出器**を並行して走らせて、最も早い位置で切り捨てる後処理を追加しました。

```typescript
export function trimCtcLoopTail(text: string): string {
  const wordTrim = findWhitespaceLoopStart(text);      // "the the the"
  const charTrim = findCharLevelLoopStart(text);       // ".ES.ES.ES"
  const mutTrim = findMutationClusterStart(text);      // "CHANGE CHAND CHAND"
  const candidates = [wordTrim, charTrim, mutTrim].filter(x => x !== -1);
  if (candidates.length === 0) return text;
  const cut = Math.min(...candidates);
  return text.slice(0, cut).trimEnd();
}
```

![3種類のCTCループパターンをそれぞれ検出する後処理](/images/07-02-ctc-loop-patterns.png)

### 2. mutation-cluster の識別ロジック

3 番目 (`findMutationClusterStart`) は少し工夫があります。**「同じトークンが 2 連続 + その 1 つ前が prefix mutation of them」**なら CTC の崩壊とみなす、というルール。

`CHANGE CHAND CHAND` の場合:

- `CHAND` と `CHAND` が identical pair
- 直前の `CHANGE` は `CHAND` と prefix `CHAN` (4 文字) を共有 (3〜10 文字の短いトークン)
- → mutation cluster と判定 → `CHANGE` の位置から切り捨てて `CHANGELOG` が残る

**identical pair を必須にすることで**、`change changed changes` のような普通の英文 (似ているだけの隣接語) は誤発火しません。ここが実データ (`change changed changes` 系の legitimate な文章) を守るための重要な工夫でした。

### 3. 「はい はい はい」を守る CHANT_MAX_LEN

CTC ループ除去を仕込んだあと、実データで確認したら **今度は legitimate な「はい はい はい」が空文字になる**という新しい問題が出ました。

言われてみれば当然で、"3 連続の同一トークン" は CTC ループの signature でもあるし、chant の signature でもある。両者を出力だけから区別するのは困難です。

そこで**長さヒューリスティック**を入れました。

- CTC ループは PARSeq の max seq (~100 文字) を埋める形で長くなる
- 意図的 chant / 擬音 / 強調は普通 30 文字未満に収まる
- 3 検出器のいずれも「**pos=0 から始まる + 全長 30 文字未満**」なら trim をスキップ

```typescript
const CHANT_MAX_LEN = 30;
// findWhitespaceLoopStart 内
if (start === 0 && text.length < CHANT_MAX_LEN) return -1;
```

これで:

| 入力 | 挙動 |
|---|---|
| `はい はい はい` (8字) | ✓ 保持 |
| `ありがとう ありがとう ありがとう` (17字) | ✓ 保持 |
| `ドドドドドドド` (7字) | ✓ 保持 |
| `the the the ... the` (60+字) | ✗ trim (CTC 通り) |
| `CHANGELOG CHANGE CHAND CHAND ...` | ✗ trim (pos>0 なので長さに関係なく) |

### 4. 暗背景の PARSeq 入力を色反転する

もう一つの原因として、**PARSeq (tegaki2 モデル) は白背景・黒文字で学習されている**ため、暗背景の Latin (GitHub dark theme のリンクなど) が分布外になって CTC ループを吐きやすい、というのがありました。

これは後処理では根治しないので、**PARSeq に渡す前に色反転**してモデルの学習分布に寄せる処理を入れました。

```typescript
const bg = dominantBorderColor(imageData);
const invertBg = shouldInvertForParseq(bg);   // luma < 90 なら暗背景
const canonical = invertBg ? invertColors(imageData) : imageData;
// canonical (light-bg-dark-text) を band 抽出 → trim → PARSeq
```

判定は border 全体の dominant color の Rec.709 luma が閾値 (90/255) 未満か。GitHub dark の `#0d1117` は luma ~15 で余裕をもって暗判定されます。

### 5. DEIM がスコアで見逃した暗チップの救済経路

DEIM の検出は confidence スコアで足切りされているため、**暗背景の小さなリンクチップは 0 検出になりやすい**ことがわかりました。この場合、これまでは空結果を返して終わりでした。

そこで **DEIM 0 検出時に、画像が中サイズ (短辺 ≤ 500px) なら小画像 bypass path にフォールバック**するようにしました。加えて、DEIM が line を検出しても **全 line で PARSeq が empty (CTC ループを trim して空になった)** の場合も、同じフォールバックを走らせます。

```typescript
const detections = await detector!.detect(imageData);
if (detections.length === 0 && Math.max(imgW, imgH) <= 500) {
  await runBypass(); return;  // フォールバック
}
// ... 通常の DEIM path で処理 ...
const anyText = resultLines.some(r => r.text.trim().length > 0);
if (!anyText && Math.max(imgW, imgH) <= 500) {
  await runBypass(); return;  // 全 line 空の場合もフォールバック
}
```

これで DEIM のスコア閾値では拾えないが PARSeq には読める暗チップ (GitHub のリンクチップ等) を救済できます。

## 実データでのテスト

改善で怖いのは「新しい問題が入ってないか」。今回は既存フィクスチャの regression テストに加えて、**実際にユーザーが踏んだ PNG を fixture 化して E2E に突っ込む**運用を入れました。

`test/e2e/fixtures/user-report-changelog.png` に実 PNG を置いて:

```typescript
test("OCR of the actual user PNG does not leak CTC/mutation-loop garbage", async () => {
  const bytes = readFileSync("test/e2e/fixtures/user-report-changelog.png");
  const result = await harness.evaluate((b) => window.__ocr.run(b), [...bytes]);
  // CTC ループパターンが出ない
  expect(looksLikeCtcLoop(result.text)).toBe(false);
  // ユーザーが実際に見た誤検出パターンが再発しない
  expect(result.text).not.toMatch(/CHAND CON/i);
  expect(result.text).not.toContain(".ES.ES");
  // 正解の prefix は残る
  expect(result.text.toUpperCase()).toContain("CHANGELOG");
});
```

**HTML fixture の screenshot だと font rendering が Playwright の Chromium で綺麗すぎて再現できない失敗** も、実 PNG なら忠実に再現できます。これは今回の対応で一番効いた工夫かもしれない。

## テスト全体像

最終的にこの規模のテストで守っています:

| Suite | 件数 | カバー範囲 |
|---|---|---|
| vitest (Node) | 156 pass / 14 files | 純粋ロジック + onnxruntime-node による OCR 統合 |
| Playwright E2E | 21 pass + 3 fixme | Chromium 実描画 + OCR パイプライン全経路 |

3 件の fixme は **既知の PARSeq 自体の限界** (英語短文の decode / 単字反復 / underline stroke) で、v0.8.1 の対応範囲外。CHANGELOG に明記しています。

## 振り返り

- **「速くする」だけの PR にはならなかった**。並列化を投げたら別の潜在バグが表面化して、それを直したら副作用が出て、その副作用を守るためにガードを入れて…と 7 commits に膨らみました
- **legitimate なデータ (chant, 擬音, 「ありがとう×3」) を守るヒューリスティック** は、実際に手を動かして初めて出てくる要件でした。「なんとなく怪しいから消す」のではなく、**判別しにくい 2 種類の signal をどう区別するか** という設計判断が必要になる
- **実 PNG を E2E fixture にする**運用は再現性 100% で今後も続けていきたい。fixture のためだけに写経 HTML を作ると Playwright の rendering に引っ張られてバグが再現しないことがある

高速化の裏側は、こういう「品質を落とさない仕掛けを積む地味な作業」だったなあ、というのが今回の学びでした。

## おわりに

v0.8.1 で、**多行ページで実質 3 倍速** + **暗背景 Latin チップの誤検出改善** が入っています。

現在 **Chrome Web Store に申請中で審査待ち**の状態です。審査を通ればストアで自動アップデートが降ってきます。もし触ってみていただけたら嬉しいです (手元のソースを clone してビルドすればすぐ試せます):

https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd

https://github.com/tamoco-mocomoco/offline-ocr

「速くする」と「間違えない」を両立していきます。
