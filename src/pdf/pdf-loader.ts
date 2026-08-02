/**
 * Thin wrapper around `pdfjs-dist` exposing a small, testable surface:
 *
 *   loadPdf(bytes) → PdfDocument
 *     .pageCount
 *     .getPage(n) → PdfPage
 *       .pageNumber / .width / .height
 *       .render(scale?) → Blob (PNG)
 *     .destroy()
 *
 * All pdfjs-internal errors are normalized into one of three classes so
 * the UI layer can present clear, translated messages without leaking
 * library-internal names.
 *
 * Design decisions:
 *  - Pages are 1-indexed (matches pdfjs convention + user expectation).
 *  - `render(scale=1.5)` picks a slightly-super-sampled default that has
 *    been fine for OCR quality across common document DPI.
 *  - `loadPdf` deliberately does not accept a password callback — password-
 *    protected PDFs throw immediately (see design § 2.2).
 *  - The pdfjs Worker source is set via `import.meta.url` so Vite bundles it
 *    alongside the caller's chunk; no CDN reference (see design § 5.4).
 */

// The `legacy` build ships polyfills for modern browser APIs (DOMMatrix,
// structuredClone, etc.) that pdfjs relies on. Using it means the loader
// works both in Chrome and in vitest's Node runtime with no extra shims.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/types/src/display/api";
// Bundle the worker chunk with Vite so the loader works fully offline.
// `?url` on a .mjs asks Vite to emit it and give us the resolved URL.
// In the Node test environment this import is not executed because we set
// `disableWorker: true` before calling `getDocument`; see below.
// eslint-disable-next-line import/no-unresolved
// @ts-expect-error - Vite-only import, resolved at bundle time
import PdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class PdfPasswordError extends Error {
  constructor() {
    super("PDF is password-protected");
    this.name = "PdfPasswordError";
  }
}

export class PdfLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfLoadError";
  }
}

export class PdfRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfRenderError";
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PdfPage = {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  render(scale?: number): Promise<Blob>;
};

export type PdfDocument = {
  readonly pageCount: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Worker setup
// ---------------------------------------------------------------------------

let workerConfigured = false;

async function configureWorker(): Promise<void> {
  if (workerConfigured) return;
  workerConfigured = true;
  const isBrowser =
    typeof window !== "undefined" && typeof document !== "undefined";
  if (isBrowser && typeof PdfWorkerUrl === "string") {
    // In the extension: point pdfjs at the worker chunk Vite emitted.
    pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorkerUrl;
  } else {
    // In Node (vitest): resolve the worker script via createRequire and give
    // pdfjs its filesystem path. pdfjs runs it as a "fake worker" on the
    // main thread when a real Worker constructor isn't available.
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    pdfjsLib.GlobalWorkerOptions.workerSrc = req.resolve(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
    );
  }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load a PDF from raw bytes. Returns a lightweight handle; the actual
 * page content is fetched lazily by `getPage`.
 *
 * Errors:
 *   - PdfPasswordError  — the PDF is encrypted and needs a password
 *   - PdfLoadError      — bytes are not a valid PDF, or the header is bad
 */
export async function loadPdf(
  source: Uint8Array | ArrayBuffer,
): Promise<PdfDocument> {
  await configureWorker();

  // pdfjs mutates the buffer it receives. Copy to a fresh Uint8Array so we
  // don't disturb the caller's view of the data.
  const data =
    source instanceof Uint8Array
      ? new Uint8Array(source)
      : new Uint8Array(source);

  const loadingTask = pdfjsLib.getDocument({
    data,
    // No auto-fetch/stream: bytes are already in-memory
    disableAutoFetch: true,
    disableStream: true,
    // CSP-friendly: never eval
    isEvalSupported: false,
  });

  let doc: PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    if (isPasswordException(err)) throw new PdfPasswordError();
    throw new PdfLoadError(errorMessage(err));
  }

  let destroyed = false;

  const document: PdfDocument = {
    pageCount: doc.numPages,

    async getPage(pageNumber: number): Promise<PdfPage> {
      if (destroyed) {
        throw new PdfRenderError("PDF document has been destroyed");
      }
      if (
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > doc.numPages
      ) {
        throw new RangeError(
          `page number ${pageNumber} out of range 1..${doc.numPages}`,
        );
      }
      const page: PDFPageProxy = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      return {
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        async render(scale = 1.5): Promise<Blob> {
          if (destroyed) {
            throw new PdfRenderError("PDF document has been destroyed");
          }
          return renderPageToPngBlob(page, scale);
        },
      };
    },

    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      // In pdfjs v6, `destroy()` on the loading task tears down the worker
      // and any live document handles associated with it.
      await loadingTask.destroy();
    },
  };

  return document;
}

// ---------------------------------------------------------------------------
// Rendering (browser only)
// ---------------------------------------------------------------------------

async function renderPageToPngBlob(
  page: PDFPageProxy,
  scale: number,
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new PdfRenderError(
      "PDF page rendering is only supported in a browser context",
    );
  }
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new PdfRenderError("failed to acquire 2D canvas context");
  }
  try {
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  } catch (err) {
    throw new PdfRenderError(errorMessage(err));
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new PdfRenderError("canvas.toBlob returned null");
  return blob;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function isPasswordException(err: unknown): boolean {
  // pdfjs throws instances whose constructor is named "PasswordException".
  // The class is exported but easiest to identify by name.
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "PasswordException") return true;
  if (typeof e.message === "string" && /password/i.test(e.message)) return true;
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
