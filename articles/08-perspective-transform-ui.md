---
title: "斜めから撮った紙面もOCRしたい — Chrome拡張に透視変換UIを足した話 (v0.9.0)"
emoji: "📐"
type: "tech"
topics: ["chrome拡張", "ocr", "画像処理", "個人開発", "typescript"]
published: false
---

:::message
**この記事について**: v0.9.0 は現在 Chrome Web Store に申請中で、審査完了を待っている状態です。ストアに反映されるまで数日〜数週間ほどかかる想定なので、記事は先出しで書いています。手元の zip (`offline-ocr.zip`) では動作確認済みで、CHANGELOG (JA/EN) とストア説明も更新済みです。
:::

## はじめに

[Chrome拡張「オフラインOCR」](https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd) の v0.9.0 で、**ビューアーに「ゆがみ補正で選択」モード**を追加しました。斜めから撮った紙面や、机に置いた本を斜め上から撮った写真のように、パースがついて歪んで写っている文字でも、**4つのハンドルで四隅を囲むと透視変換で平面化してから OCR にかけてくれる** という機能です。

![斜めに写った「オフライン処理」を4隅ハンドルで囲むと、平面化された画像が OCR に渡る](/images/08-01-before-after.png)

これまでは「範囲選択（四角）」と「画像全体」の2択だったので、斜めに写った紙面を OCR したいときは、頑張って外接矩形で囲んで余計な背景まで OCR に食わせるか、画像自体を事前に別アプリで平面化してからビューアーに読ませるかの二択でした。前者は OCR 精度が落ちるし、後者はオフラインで完結する利点を打ち消してしまいます。

透視変換 (perspective transform) 自体は OpenCV なんかで馴染みのある処理ですが、**Chrome拡張 x WebAssembly OCR の中で、追加の外部ライブラリ無しで、UI としても気持ちよく収まるように** 入れるのは意外と気を遣いました。この記事はその記録です。

以前の記事はこちら:

- [作った話 (1本目)](https://zenn.dev/lecto/articles/a2ee65243b02b3)
- [ストア素材・動画を HTML+CSS で作った話 (2本目)](https://zenn.dev/lecto/articles/3b1606a8ac859e)
- [作って公開してからちょこちょこ直した話 (3本目)](https://zenn.dev/lecto/articles/0ff674ad00181f)
- [プロモ動画の活動報告 (4本目)](https://zenn.dev/lecto/articles/f1b0f0b0f0b0f0)
- [「小さな範囲選択」問題とパディング (5本目)](https://zenn.dev/lecto/articles/small-selection-padding-journey)
- [PDF対応にした話 (6本目)](https://zenn.dev/lecto/articles/pdf-ocr-support)
- [OCR並列化と品質崩壊 (7本目)](https://zenn.dev/lecto/articles/offline-ocr-speed-and-quality)

https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd

https://github.com/tamoco-mocomoco/offline-ocr

## なぜ必要だったのか

OCR のスコアを決める大きな要因のひとつが「文字がちゃんと水平に、歪みなく写っているか」です。NDLOCR-Lite が使っている PARSeq は、学習時にある程度の傾き・ゆがみを許容していますが、**本を机に置いて斜め上から撮った**ような画像だと、下に行くほど文字が小さくなり、辺が消失点に向かって傾くので、ラインごとの切り出しがそもそも破綻します。

ここで Chrome Web Store のレビューに「斜めに撮った紙面も読みたい」という要望が複数回入っていて、既存の「範囲選択（四角）」モードでは根本的に対応できないことがわかっていました。

対策は 2 択:

1. **PARSeq の前処理に傾き検出を入れる** — 自動化できるが、確信を持てないケースも多く暴走リスクがある
2. **ユーザーに四隅を指定してもらって透視変換で平面化してから OCR に渡す** — 手数は増えるが、確実

精度と確実性を優先して (2) を選びました。「ユーザーに手を動かしてもらう代わりに、信頼できる結果を返す」のがオフラインOCRの軸にしているポリシーなので、ここは一貫させています。

## 透視変換のおさらい

4点対応からホモグラフィ行列 H (3x3) を求めて、各ピクセルに逆変換を当てる、という定番手順です。

![左: 4点対応からホモグラフィ行列を解く / 右: dst→src の逆写像 + 双一次補間 / 下: 既存パイプラインに「平面化」を 1 ステップ挟むだけ](/images/08-03-pipeline.png)


$$
\begin{pmatrix} X w \\ Y w \\ w \end{pmatrix} =
\begin{pmatrix} h_0 & h_1 & h_2 \\ h_3 & h_4 & h_5 \\ h_6 & h_7 & 1 \end{pmatrix}
\begin{pmatrix} x \\ y \\ 1 \end{pmatrix}
$$

未知数 8 個 (h₀..h₇, h₈=1 で正規化)、4 点対応 ×2 制約 = 8 方程式なので、8x9 の拡大係数行列を Gauss 消去すれば一意に解けます。

今回は参考リポジトリ [tamoco-mocomoco/ndlocr-lite-wasm](https://github.com/tamoco-mocomoco/ndlocr-lite-wasm) で既に実装していた純 TypeScript 版をそのまま流用しました。`src/ocr/engine/perspective.ts` に `computeHomography(src[], dst[]): number[]` と `applyPerspective(imageData, matrix, outW, outH): ImageData` が入っています。

ホモグラフィ計算 (抜粋):

```typescript
export function computeHomography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y, X]);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y, Y]);
  }
  const h = solveLinearSystem(A); // Gauss 消去 (partial pivoting)
  return [...h, 1];
}
```

適用側は **逆写像 + 双一次補間** です。順写像で書くと穴が開くので (dst の整数格子を埋めきれない)、dst から src へ逆引きして、src の実数座標の周囲 4 画素を混ぜる。範囲外は黒 (alpha=255)。

```typescript
for (let dy = 0; dy < outH; dy++) {
  for (let dx = 0; dx < outW; dx++) {
    const w = inv[6] * dx + inv[7] * dy + inv[8];
    const sx = (inv[0] * dx + inv[1] * dy + inv[2]) / w;
    const sy = (inv[3] * dx + inv[4] * dy + inv[5]) / w;
    // ... bilinear 4 画素合成
  }
}
```

モデル推論と違って純粋な四則演算なので、WASM 版も検討しましたが、現状のビューアーで扱うサイズ (数百 px〜数 Mpx) なら JS で十分間に合うので、依存を増やさない方を選びました。

## UI の設計 — 「四隅で選択」から「ゆがみ補正で選択」へ

機能実装よりも、ボタンの文言とハンドル UI の挙動に時間を使いました。完成形はこんな感じです:

![ビューア UI 全体。ツールバーに「ゆがみ補正で選択」ボタン、キャンバスに歪んだ紙面と4隅ハンドル、右上に補正後プレビューパネル](/images/08-02-viewer-ui.png)


### ボタン名の試行錯誤

初版では開発中コードネームそのまま「**台形選択**」というボタン名でした。幾何学の用語で正確なんですが、ユーザーテストの反応が芳しくない。「台形って何するボタンなんだろう?」と止まってしまう。

次に **「四隅で選択」** にしました。操作 (4隅ハンドルで囲む) をそのまま名前にしたんですが、これも「四隅…? ふむ…?」と目的がピンと来ない。

最終的に **「ゆがみ補正で選択」** にしました。ChromeやiPhoneのカメラアプリ、Google ドライブのスキャン機能、CamScanner などで広く「ゆがみ補正」という表現が使われているので、ユーザー側の予備知識にヒットしやすい。英語版は `Deskew & Select` にしています。

ボタン名で学んだこと:

- **操作名より目的名** — ユーザーは「何をするか」より「何が得られるか」でボタンを選ぶ
- **既存アプリの定着語彙に揃える** — スキャナーアプリに触れている人は「ゆがみ補正」でクリックする閾値が低い
- **技術用語 (quad, trapezoid, 台形) は見出し語にしない** — コード側の識別子 (`QuadState`, `quad-selection.ts`) には残していい

### ハンドルの凸性制約

4 隅を自由にドラッグできるようにすると、必ず誰かが「反対側の点を跨いで引っ張って自己交差させる」操作をします。自己交差した 4 角形に対してホモグラフィを計算すると、画像が折り畳まれて意味不明になるので、**ドラッグを受け付ける時点で凸性チェックで弾く** 設計にしました。

```typescript
export function moveCorner(
  state: QuadState,
  idx: Corner,
  p: Point,
  imgW: number,
  imgH: number,
  minInsetPx = 2,
): QuadState {
  const clampedX = clamp(p.x, minInsetPx, imgW - minInsetPx);
  const clampedY = clamp(p.y, minInsetPx, imgH - minInsetPx);
  const next: [Point, Point, Point, Point] = [ /* ... */ ];
  next[idx] = { x: clampedX, y: clampedY };
  if (!isConvexQuad(next)) {
    return state; // 自己交差になる動きは reject
  }
  return { corners: next, draggingIndex: state.draggingIndex };
}
```

凸性チェックは「4辺の cross product の符号が全部一致するか」で判定。collinear (3点が一直線) も退化なので弾いています。

```typescript
export function isConvexQuad(pts: readonly Point[]): boolean {
  if (pts.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}
```

UI 的には **凸性違反の瞬間、ハンドルがそこで止まる** だけなので、ユーザーは「あ、これ以上動かないのね」で自然に受け入れてくれます (ユーザビリティテストで確認)。エラートーストとか説明は出していません。

![凸性 OK / 自己交差 NG / reject されたときはハンドルがそこで止まる の3状態](/images/08-04-convexity.png)


### 補正後プレビュー

4隅ドラッグをしていると、「で、実際どんな画像が OCR に流れるのか?」が気になります。ボタンを押すまで分からないと、押してから OCR 失敗 → やり直し、のループになるので、**ドラッグ中はリアルタイムで補正後プレビューを右上に表示** するようにしました。

実装のポイントは 2 つ:

1. **ソース ImageData を quad モード開始時に 1 度だけキャッシュ** — ドラッグごとに `getImageData` を呼ぶとオーバーヘッドが積もるので、`showQuadPreview()` のタイミングで一度取っておく
2. **requestAnimationFrame で間引く** — mousemove は毎フレーム以上の頻度で来るので、`quadPreviewRafPending` フラグで rAF 1 本に合体
3. **プレビュー解像度を 240px にクランプ** — ソースが 2000x2000 でも、プレビューは最大 240px に収めるので、`applyPerspective` のループ回数が爆発しない

```typescript
function updateQuadPreview(): void {
  if (quadPreviewRafPending) return;
  quadPreviewRafPending = true;
  requestAnimationFrame(() => {
    quadPreviewRafPending = false;
    if (!quadMode || !quadState || !quadSrcData) return;
    const size = suggestOutputSize(quadState);
    const scale = Math.min(
      1,
      QUAD_PREVIEW_MAX_PX / size.w,
      QUAD_PREVIEW_MAX_PX / size.h,
    );
    const outW = Math.max(2, Math.round(size.w * scale));
    const outH = Math.max(2, Math.round(size.h * scale));
    const H = computeHomography(quadState.corners, outputCornersFor(outW, outH));
    const warped = applyPerspective(quadSrcData, H, outW, outH);
    quadPreviewCanvas.width = outW;
    quadPreviewCanvas.height = outH;
    quadPreviewCanvas.getContext("2d")!.putImageData(warped, 0, 0);
  });
}
```

数Mpx級の画像でもドラッグがカクつかずに済んでいます。

### Enter キーで確定

ハンドルを合わせ終わってから「この範囲でOCR」ボタンまでカーソルを動かすのは地味に手数なので、**Enter で OCR 実行** も効くようにしました。

地雷ポイントが 1 つあって、「ゆがみ補正で選択」ボタンを押した直後は **そのボタンに focus が残っています**。この状態で Enter を押すと、ボタンの click が再発火して quad が初期状態にリセットされてしまう。これに気づいたので、click ハンドラの最初に `btnQuadSelect.blur()` を入れました。

```typescript
btnQuadSelect.addEventListener("click", () => {
  if (!img) return;
  // Blur so Enter doesn't re-fire this handler (which would reset the quad).
  btnQuadSelect.blur();
  // ... quad state init ...
});

document.addEventListener("keydown", (e) => {
  if (
    e.key === "Enter" &&
    quadMode &&
    quadState &&
    quadState.draggingIndex === -1
  ) {
    // confirm button に focus があるときはネイティブ click に任せる
    if (e.target === btnQuadConfirm) return;
    e.preventDefault();
    void confirmQuad();
  }
});
```

## 既存 OCR パイプラインへの合流

透視変換で平面化した画像を、既存のパイプラインに **余計な処理を足さずに** そのまま流し込みたい。この部分は viewer.ts の `runOcr()` を軽くリファクタして `sendImageToOcr(source, crop)` に切り出すだけで済みました。

```typescript
async function sendImageToOcr(
  source: HTMLCanvasElement | OffscreenCanvas,
  crop: { x: number; y: number; w: number; h: number },
): Promise<void> {
  // ... 隣接色パディング → PNG → chrome.runtime.sendMessage → offscreen OCR
}

async function runOcr(): Promise<void> {
  if (!ctx || !img || !selRect) return;
  await sendImageToOcr(canvas, selRect);
}

async function confirmQuad(): Promise<void> {
  if (!ctx || !img || !quadState) return;
  const { w: outW, h: outH } = suggestOutputSize(quadState);
  const H = computeHomography(quadState.corners, outputCorners(outW, outH));
  const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const warped = applyPerspective(srcData, H, outW, outH);

  const warpedCanvas = new OffscreenCanvas(outW, outH);
  warpedCanvas.getContext("2d")!.putImageData(warped, 0, 0);
  // ... UI 状態をリセット
  await sendImageToOcr(warpedCanvas, { x: 0, y: 0, w: outW, h: outH });
}
```

**v0.7.1 で入れた row-ink profile、v0.8.1 で入れた CTC ループ検出、暗背景インバート、etc.** が自動的に効くのがポイント。「ゆがみ補正だけのために OCR の下流に専用パスを分岐」をしなくて済んでいます。

## テスト — ImageData が無い世界と、CSS perspective で作る斜め fixture

### ユニットテスト

純粋ロジックは vitest で:

- `src/viewer/__tests__/quad-selection.test.ts` — 初期配置、凸性維持、クランプ、ヒット判定、出力サイズを 18 ケース
- `src/ocr/engine/__tests__/perspective.test.ts` — 恒等、スケール、平行移動、切り出し、範囲外の 7 ケース

後者で地味に困ったのが **Node に ImageData クラスが無い** こと。`applyPerspective` 内で `new ImageData(outW, outH)` しているので、テスト側で最小シムを import 前に差し込む必要がありました。

```typescript
// Node lacks the DOM ImageData class. Shim it *before* importing the module
// under test so `new ImageData(...)` inside applyPerspective resolves.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === "undefined") {
  class ImageDataShim {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(arg1: number | Uint8ClampedArray, arg2: number, arg3?: number) {
      if (typeof arg1 === "number") {
        this.width = arg1;
        this.height = arg2;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = arg1;
        this.width = arg2;
        this.height = arg3 ?? arg1.length / 4 / arg2;
      }
    }
  }
  (globalThis as { ImageData: unknown }).ImageData = ImageDataShim;
}

import { computeHomography, applyPerspective } from "../perspective";
```

jsdom / happy-dom をフル投入するほどではないので、「テストで困るのは `new ImageData()` だけ」であればこのレベルの shim で十分です。

### E2E — CSS perspective で斜めに写った紙面を作る

ホモグラフィの単体テストだけだと「数式としては正しいが、実際の OCR パイプラインに繋いだときに崩れないか」が確認できません。そこで Playwright で、

1. CSS の `perspective` + `rotateY` + `rotateX` で**斜めに写った紙面** を描画した fixture ページを作る
2. そのページを `page.screenshot()` で撮って PNG を得る
3. ページ側に生えている `window.__cornersInViewport()` から **写った文字の 4 隅の実座標** を取得
4. harness の `window.__warp.unwarp()` に PNG と 4 隅を渡して平面化
5. 平面化された PNG を既存の OCR worker に流し込んで、認識結果に期待のテキストが含まれるかを assert

という流れの統合テストを足しました。fixture 側の HTML はこんな感じ:

```html
<div id="stage" style="perspective:900px; perspective-origin:50% 50%;">
  <div id="target" style="transform:rotateY(-28deg) rotateX(6deg);">
    オフライン処理
  </div>
</div>
<script>
  window.__cornersInViewport = () => {
    const el = document.getElementById("target");
    // local (0,0)..(w,h) -> local 中心からの変換 -> perspective の除算
    // ... (DOMMatrix と perspective 値から projection する)
  };
</script>
```

CSS perspective での projection は DOM API だけで解けるので、`DOMMatrix.transformPoint` + 親要素の `perspective` 値による z 除算 を自前で組み合わせて、変換後の 4 隅の viewport 座標を取ります。

アサーションは「`オフライン` が結果テキストに含まれる」だけのゆるいもの。目的が「透視変換 → OCR が壊れていないこと」なので、精度の数値を押さえるというよりは、**パイプライン全体の形状保存** を見ています。

実行結果:

```
✓  test/e2e/perspective.spec.ts:15:3 › perspective transform (four-corner selection) › unwarping a photographed-page fixture recovers the text (7.4s)
```

7.4秒。CI でも許容範囲。

### テスト全体像

| Suite | 件数 | カバー範囲 |
|---|---|---|
| vitest | 183 pass / 16 files | ロジック + OCR 統合 + 透視変換 25 ケース |
| Playwright E2E | 22 pass + 3 fixme | Chromium 実描画 + OCR 全経路 + 透視変換 1 ケース |

## まとめ

- **「ゆがみ補正で選択」モード**を v0.9.0 で追加。斜めから撮った紙面でも、4つのハンドルで四隅を囲めば平面化して OCR してくれる
- **透視変換は純 TypeScript 実装** (`computeHomography` + `applyPerspective`)。外部ライブラリ追加なし、通信ゼロのポリシーは維持
- **UI の文言は「操作名」ではなく「目的名」に** 寄せる (「四隅で選択」→「ゆがみ補正で選択」)
- **凸性制約・ライブプレビュー・Enter キー** といった小さな工夫で、専門的な操作のハードルを下げる
- **既存パイプラインに合流させる** 設計にしたので、過去の精度改善が全部効く
- **CSS perspective fixture で E2E** まで通せた。「斜めから撮った紙面」を手持ちのサンプル無しに再現できるのは便利

透視変換自体は枯れた技術ですが、「WASM OCR のオフライン拡張の UI にどう溶かし込むか」という組み合わせはそれなりに考えどころがありました。

## おわりに

v0.9.0 で、**ゆがみ補正OCR** が入っています。

現在 **Chrome Web Store に申請中で審査待ち**の状態です。審査を通ればストアで自動アップデートが降ってきます。斜めに撮った名刺・レシート・本の見開き・ホワイトボード写真などで試していただけたら嬉しいです。

https://chromewebstore.google.com/detail/offline-ocr/cfppiicaeemimcbodibggnnolckcpmpd

https://github.com/tamoco-mocomoco/offline-ocr

「正面から撮ってください」と言われないOCR、を目指していきます。
