# 紹介サイト (GitHub Pages)

https://tamoco-mocomoco.github.io/offline-ocr/ のページ。`.github/workflows/pages.yml` が `site/` を公開の一番上に置く (ストアのスクリーンショット用の `store/screenshots.html` は `/store/screenshots.html` に残る)。

- [index.html](index.html): 1 枚のページ。日本語と英語は `data-en` で切り替える (日本語がもとの中身、英語は属性に持つ)
- `assets/`: 絵 (webp)、OGP 画像、たもこの絵。絵は local-imagegen の zimage-turbo で生成し、[assets-src/make_assets.py](assets-src/make_assets.py) で webp にした。絵の中の文字は、OCR (test/e2e/ocr-images.spec.ts) に通したうえで、拡大して目でも確かめる (OCR は知らない字を近い日本の字に読み替えるため)。直らない文字は、文字なしで描いて HTML で重ねるか、`retype` で書体で組み直す
- [assets-src/prompts.json](assets-src/prompts.json): 絵ごとの指示と seed。`expect` は絵の中に読めるはずの文字で、`test/e2e/ocr-images.spec.ts` (拡張と同じ OCR) で確かめてから使う。誤字が直らなかった絵 (`_tried` に記録) は文字なしで描き、文字は index.html で重ねている

手元で確かめるときは、pages.yml と同じ並びで `_site/` を作って開く:

```bash
mkdir -p _site/public/icons _site/store && cp -r site/* _site/ && cp store/screenshots.html _site/store/ \
  && cp store/privacy-policy.html _site/ && cp -r public/icons/* _site/public/icons/ && open _site/index.html
```
