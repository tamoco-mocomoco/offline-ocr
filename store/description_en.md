Offline OCR — A safe, fully offline region-select OCR

Select any area on screen with your mouse to recognize text and copy it to your clipboard instantly.
Powered by NDLOCR, an OCR engine developed by the National Diet Library of Japan (NDL), delivering high-accuracy Japanese text recognition.
All processing happens entirely in your browser. No internet connection required — your images and text are never sent to any external server.

■ Key Features

- Fully offline — your data never leaves your device
- One-click usage — just select a region and text is automatically copied
- Optimized for Japanese — powered by the National Diet Library's OCR technology
- 3 ways to launch — toolbar icon / keyboard shortcut / right-click menu
- Regex cleaning rules — auto-remove commas, spaces, or line breaks before copying. Create your own custom rules to fit your workflow, such as stripping digit separators from invoice amounts
- Image viewer — open local images or clipboard images for OCR, with zoom and region selection
- Multilingual UI — automatically switches between Japanese and English

■ How to Use

1. Click the extension icon (or use the keyboard shortcut)
2. Drag to select the area you want to OCR
3. Wait a few seconds — the result is automatically copied to your clipboard

💡 Image viewer
   You can also OCR local image files and clipboard images.
   - From the extension popup: "Open Image" / "Open Clipboard Image"
   - Right-click an image on any web page → "Open Image in Viewer"
   In the viewer you can zoom in to select a region, or OCR the entire image at once.

■ Great For

- Copying text from PDFs or images
- Quickly extracting numbers from invoices and receipts
- Transcribing text from screenshots
- Working with confidential documents you don't want to upload to external services

■ Privacy

Offline OCR makes absolutely no network requests.
The OCR engine (ONNX Runtime Web) and models are fully bundled within the extension and run entirely inside your browser.
No personal data or images are ever collected or transmitted.

■ Technical Details

- OCR Engine: NDLOCR-Lite (lightweight version of the National Diet Library OCR)
- Detection Model: DEIM (FP32)
- Recognition Model: PARSeq (FP32)
- Inference Runtime: ONNX Runtime Web (WebAssembly)
- Supported Languages: Japanese (horizontal text)
- Requirements: Chrome 116 or later

■ Acknowledgments

The OCR engine and models used in this extension are based on NDLOCR, researched, developed, and published by the National Diet Library of Japan (NDL).
We sincerely thank the National Diet Library for making their high-accuracy Japanese OCR technology openly available.

■ Changelog

v0.4.0
- Added "Open Image in Viewer" to the image right-click menu

v0.3.0
- Added the image viewer (OCR for local images and clipboard images)
- Supports file selection / drag & drop / Ctrl+V paste

v0.2.0
- Improved recognition accuracy so OCR works even with tight region selections

v0.1.0
- Initial release
