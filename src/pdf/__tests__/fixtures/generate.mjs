/**
 * One-shot script to regenerate the test fixture PDFs.
 *
 * Run:
 *   node src/pdf/__tests__/fixtures/generate.mjs
 *
 * Produces:
 *   - hello-3page.pdf         : 3 pages, each with clearly-different Japanese
 *                                text, so tests can distinguish pages
 *   - password-protected.pdf  : same content, encrypted with user password
 *                                "secret" so loadPdf can reject it
 *
 * The output is committed to the repo. This script only needs to be re-run
 * when the fixture spec changes.
 */

import PDFDocument from "pdfkit";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  "ページ 1: こんにちは",
  "ページ 2: サンプル",
  "ページ 3: おわり",
];

function writePdf(path, { password } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const opts = { size: "A4", margin: 60 };
    if (password) {
      opts.userPassword = password;
      opts.ownerPassword = password;
    }
    const doc = new PDFDocument(opts);
    const stream = createWriteStream(path);
    doc.pipe(stream);
    doc.fontSize(28);
    PAGES.forEach((line, i) => {
      if (i > 0) doc.addPage();
      doc.text(line, 60, 120);
    });
    doc.end();
    stream.on("finish", () => resolvePromise(path));
    stream.on("error", rejectPromise);
  });
}

const normalPath = resolve(HERE, "hello-3page.pdf");
const encryptedPath = resolve(HERE, "password-protected.pdf");

await writePdf(normalPath);
console.log(`wrote ${normalPath}`);

await writePdf(encryptedPath, { password: "secret" });
console.log(`wrote ${encryptedPath}`);
