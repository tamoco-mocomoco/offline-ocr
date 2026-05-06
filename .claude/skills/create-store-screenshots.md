---
name: create-store-screenshots
description: アプリストア用のスクリーンショットHTMLを設計・作成するノウハウ
user_invocable: true
---

アプリストア（Chrome Web Store、App Store等）用のスクリーンショットをHTMLで作成するノウハウ。

## 事前調査

- 同カテゴリの人気アプリのストアページを見て、スクリーンショットの傾向を把握する
- 実際のアプリ画面キャプチャをそのまま載せているものは少ない。モックアップやイラストで「こう使える」「こんな価値がある」を伝えるスライド形式が主流
- 求められているのは**使い方や価値が一目で伝わるビジュアル**であって、リアルなスクショである必要はない

## なぜHTMLで作るのか

Figmaやデザインツールとの比較:
- テキスト修正がコード変更だけで済む（gitで差分管理可能）
- 多言語対応は `data-lang` 属性で1ファイルに同居できる
- デザインはCSS変数で統一管理
- Playwrightで自動キャプチャ（コマンド一発で全画像生成）
- アプリの機能を一緒に作ってきたClaudeなら「何を見せるべきか」も判断できる

## HTML構成ルール

- 1ファイルに全スライドを並べる
- 各スライドは `.slide` クラスのdiv、ストア指定サイズ（例: Chrome Web Storeは1280×800）
- CSSはすべてインライン（外部ファイル参照を避ける）
- Google Fontsでフォントを読み込む
- カラーパレットはCSS変数で統一:
  ```css
  :root {
    --primary: #5B9BD5;
    --bg-gradient: linear-gradient(135deg, #1E3A5F 0%, #2C5F8A 50%, #5B9BD5 100%);
  }
  ```

## 多言語対応

`data-lang-ja` / `data-lang-en` 属性でbodyクラスの切替だけで全テキストを差し替え:

```html
<span data-lang-ja><h1>タイトル</h1></span>
<span data-lang-en><h1>Title</h1></span>
```

display制御のCSS（inline/block/flexそれぞれパターンが必要）:
```css
[data-lang-en] { display: none; }
[data-lang-ja] { display: initial; }
body.lang-en [data-lang-en] { display: initial; }
body.lang-en [data-lang-ja] { display: none; }
div[data-lang-en], p[data-lang-en] { display: none; }
div[data-lang-ja], p[data-lang-ja] { display: block; }
body.lang-en div[data-lang-en] { display: block; }
body.lang-en div[data-lang-ja] { display: none; }
/* flex要素用も同様 */
```

## Playwrightでのキャプチャ

```javascript
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,  // Retinaで2倍サイズになるのを防止
});
```

レスポンシブ対応HTMLでもキャプチャ時はJSで固定サイズに強制:
```javascript
await page.evaluate(() => {
  document.querySelectorAll(".slide").forEach((s) => {
    s.style.width = "1280px";
    s.style.height = "800px";
    s.style.maxWidth = "none";
  });
});
```

言語切替: `document.body.classList.add("lang-en")` だけ。

## よく使うモック要素

- **モックブラウザ**: ツールバー（赤黄緑ドット + URLバー）+ コンテンツエリア
- **選択矩形**: `border: 2px solid var(--primary); background: rgba(91,155,213,0.15);`
- **トースト通知**: 右下固定、ダーク背景、チェックマーク付き
- **Before/After比較**: 赤系背景(Before) + 緑系背景(After) + 矢印
- **バッジ/タグ**: 丸角ピル型、半透明背景、絵文字アイコン付き
- **フィーチャーカード**: アイコン + タイトル + 説明のグリッド

## GitHub Pagesでティザーサイトにも

同じHTMLをGitHub Pagesで公開すれば、ストア用素材とティザーサイトを1ファイルで兼用できる。レスポンシブCSSを追加してスマホ対応も可能。

## プロモタイル

複数サイズのタイルも1ファイルにまとめてidで区別。Playwrightで要素ごとにキャプチャ:
```javascript
const handle = await page.$('#tile-small');
await handle.screenshot({ path: 'promo-small.png' });
```
