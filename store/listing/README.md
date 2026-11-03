# ストアの画像 (v2)

Chrome ウェブストアに載せる画面写真 5 枚 (1280×800) とプロモタイル (440×280、1400×560) を、日本語と英語で作る。前の版 (`store/screenshots.html`、`store/promo-tiles.html`) の作り直しで、絵と色は `site/` の紹介サイトにそろえた。

画面の中身は、HTML で描いた見本ではなく、**本物の拡張の画面**。`dist/` の拡張を Playwright の Chromium に読み込み、架空の文書を実際に OCR して撮っている。

```bash
npm run build
node store/listing/make-demo.mjs               # 見本の文書 (demo/out/)
node store/listing/capture.mjs                 # 拡張の画面 (shots/ja/)
node store/listing/capture.mjs --lang en       # 英語の画面 (shots/en/)
node store/listing/render.mjs                  # ストアに出す画像 (out/ja/、out/en/)
```

- [demo/docs.html](demo/docs.html): OCR する見本 (縦書きの本の頁、それを斜めに撮った写真、はんこと書き込みのある請求書、3 頁の企画書 PDF)。どれも架空のもの。[demo/article.html](demo/article.html) は範囲選択を撮るブログ記事で、`https://blog.example.jp/` として配る
- [capture.mjs](capture.mjs): ページの上の範囲選択、ビューアの消しゴム・ゆがみ補正・PDF、履歴、クリーニングルール、ポップアップを撮る。OCR の結果はコンソールに出るので、見本の文と合っているかを確かめる
  - `--video` を付けると、流れごとの録画 (`clips/<lang>/*.webm`) と、操作した時刻 (`*.json`) も残す。録画にはマウスが写らないので矢印を重ねる。ストアの説明動画は、この録画を使って作っている
  - Mac の Chromium は `--lang` を見ないため、英語の画面は ja の訳を抜いた `dist` の写し (`.dist-en/`) で撮る
- [screenshots.html](screenshots.html): 画面写真とプロモタイルの組み版。`?lang=en` で英語になる。プロモタイルは、キャラの絵を使わず、本物の範囲選択の画面とコピーした結果で見せる
