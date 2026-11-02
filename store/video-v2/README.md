# 紹介動画 v2 (ティザー、約 38 秒)

`site/` の紹介サイトと同じ絵と色で作った、短い紹介動画。前の動画 (`store/video/`、約 3 分半) の作り直し。

```bash
node store/video-v2/build.mjs          # store/video-v2/promo-video-v2-ja.mp4 (1920×1080)
node store/video-v2/build.mjs --kana   # 声だけ作り、読みのカナを表示する (読みの確認用)
```

- 台本は [script.json](script.json)。`text` が字幕、`say` が読み (ひらがな・カタカナで直す)、`hold` はセリフのあとに見せる間 (秒)
- 声の長さから場面の時刻を決め、[teaser.html](teaser.html) を Playwright で録画し、声と BGM を ffmpeg で重ねる。`teaser.html?scene=demo` で 1 場面だけ確かめられる
- 声は VOICEVOX:春日部つむぎ (speaker 8、速さ 1.15、抑揚 1.3)
- BGM の [bgm.mp3](bgm.mp3) は local-musicgen (ACE-Step 1.5) で作った曲: caption `bright and clean corporate tech promo, light electronic pop, soft plucky synths, gentle claps, warm piano, optimistic and trustworthy, 112 bpm, instrumental`、seed 2026、60 秒
- 絵は `site/assets/` のもの (作り方は `site/assets-src/`)
