# Changelog

[日本語版はこちら](CHANGELOG_ja.md)

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
