# Changelog

[日本語版はこちら](CHANGELOG_ja.md)

## v0.6.2 (2026-06-22)

- Properly fixed the v0.6.0 bug that v0.6.1 had temporarily rolled back, and **re-enabled the furigana filter and small-region OCR features**

## v0.6.1 (2026-06-22)

- Emergency rollback to v0.5.0 behavior. In v0.6.0, **OCR'ing short alphanumeric selections** (small button labels, commit hashes, etc.) could **append a long run of unwanted characters** (e.g. lots of `1`s or `9`s) to the result
- For example, selecting `cfa8b33` would return `cfa8b33 1999999999...`
- Properly fixed in v0.6.2

## v0.6.0 (2026-06-14)

- **Furigana (ruby text) is now automatically filtered out** in manga and ruby-annotated text. Previously the output mixed body and ruby (e.g. `いちばんかのうせい / 一番可能性を / も / 持ってるんだよ / げんや / 玄弥`); now only the main text is returned. Detection boxes that are much smaller than an adjacent larger box are treated as ruby and dropped between detection (DEIM) and recognition (PARSeq), so they're never even read
- **Small selections like button or link text are now recognized**. Tightly-cropped images (max side ≤ 200px) used to make DEIM's detection score fall under the threshold and return an empty string. For those images the detector is now bypassed: the adjacent-color padding is trimmed and the whole crop is sent to PARSeq as a single text line, with aspect-preserving resize

## v0.5.0 (2026-05-27)

- OCR output for tables and receipts is now **tab-separated**. When multiple cells are detected on the same row they are joined with `\t`, so pasting into Excel / Google Sheets places each cell in its own column
- Cleaning rule replacement strings now support **escape sequences**: `\t` (tab), `\n` (newline), `\r`, `\\`, `\0` are interpreted as the literal characters (`$1`-style back-references still work)
- Fixed a long-standing bug where the **blue selection rectangle bled into the captured image**, tinting the adjacent-color padding blue. The selection overlay is now removed and the browser is given a frame to repaint before `captureVisibleTab` runs. Detection accuracy benefits as a side effect
- Added **Debug mode** (Options page > Debug). When enabled, the cropped + padded image fed to the detector is saved and can be inspected from the options page

## v0.4.0 (2026-05-17)

- Added "Open Image in Viewer" to the image right-click menu
- Useful when you want to zoom into a small image to select a region, or when an image is hard to select directly on the page

## v0.3.0 (2026-04-29)

- Added the image viewer page (popup: "Open Image" / "Open Clipboard Image")
- Viewer supports file selection / drag & drop / Ctrl+V paste
- Viewer lets you choose "Start Selection" or "OCR Entire Image"
- Local images can be OCR'd without enabling file:// access permission
- Added clipboardRead permission
- Shared modules for settings (settings.ts) and cleaning rules
- Viewer also applies the result alert and cleaning rules
- Added a separator to the popup UI, color-coded buttons (blue = OCR / gray = open)
- Split message delivery between extension pages and normal pages (fixes duplicate alerts)

## v0.2.0 (2026-04-27)

- Added adjacent-color padding so OCR works even with tight region selections
- Pads 30% of the shorter side (max 50px) by stretching edge pixels
- Reliable detection on both light and dark backgrounds
- Added OCR integration tests (onnxruntime-node + sharp)

## v0.1.0 (2026-04-19)

- Initial release
- Region-select OCR (drag to select, copies to clipboard)
- DEIM (text region detection) + PARSeq (character recognition) + XY-Cut (reading order)
- Fully offline (zero network)
- 3 launch methods (toolbar / Alt+Shift+O / right-click menu)
- Regex cleaning rules (comma removal, space cleanup, etc.)
- Automatic JA/EN UI switching
- Model caching (IndexedDB)
