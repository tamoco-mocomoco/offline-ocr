/**
 * Unit tests for `pdf-loader.ts`.
 *
 * These tests exercise the metadata / navigation / error surface of the
 * PDF loader in a Node context. Actual page rendering (which needs a canvas
 * backend) is out of scope for vitest — the Playwright E2E in phase 2
 * covers that.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  loadPdf,
  PdfPasswordError,
  PdfLoadError,
  PdfRenderError,
} from "../pdf-loader";

const HERE = dirname(fileURLToPath(import.meta.url));
const NORMAL_PDF = resolve(HERE, "fixtures/hello-3page.pdf");
const PASSWORD_PDF = resolve(HERE, "fixtures/password-protected.pdf");

let normalBytes: Uint8Array;
let passwordBytes: Uint8Array;

beforeAll(() => {
  normalBytes = new Uint8Array(readFileSync(NORMAL_PDF));
  passwordBytes = new Uint8Array(readFileSync(PASSWORD_PDF));
});

describe("loadPdf", () => {
  it("reads a 3-page PDF and exposes the correct pageCount", async () => {
    const doc = await loadPdf(normalBytes);
    expect(doc.pageCount).toBe(3);
    await doc.destroy();
  });

  it("returns a page object with the correct pageNumber", async () => {
    const doc = await loadPdf(normalBytes);
    const page = await doc.getPage(2);
    expect(page.pageNumber).toBe(2);
    expect(page.width).toBeGreaterThan(0);
    expect(page.height).toBeGreaterThan(0);
    await doc.destroy();
  });

  it("throws RangeError for page < 1", async () => {
    const doc = await loadPdf(normalBytes);
    await expect(doc.getPage(0)).rejects.toBeInstanceOf(RangeError);
    await doc.destroy();
  });

  it("throws RangeError for page > pageCount", async () => {
    const doc = await loadPdf(normalBytes);
    await expect(doc.getPage(4)).rejects.toBeInstanceOf(RangeError);
    await doc.destroy();
  });

  it("throws PdfPasswordError for a password-protected PDF", async () => {
    await expect(loadPdf(passwordBytes)).rejects.toBeInstanceOf(
      PdfPasswordError,
    );
  });

  it("throws PdfLoadError for garbage bytes", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(loadPdf(garbage)).rejects.toBeInstanceOf(PdfLoadError);
  });

  it("throws PdfRenderError when getPage is called after destroy", async () => {
    const doc = await loadPdf(normalBytes);
    await doc.destroy();
    await expect(doc.getPage(1)).rejects.toBeInstanceOf(PdfRenderError);
  });

  it("accepts ArrayBuffer input as well as Uint8Array", async () => {
    // Copy into a fresh ArrayBuffer to make sure the input path isn't limited
    // to Uint8Array (viewer's file input reads as ArrayBuffer).
    const ab = normalBytes.buffer.slice(
      normalBytes.byteOffset,
      normalBytes.byteOffset + normalBytes.byteLength,
    );
    const doc = await loadPdf(ab);
    expect(doc.pageCount).toBe(3);
    await doc.destroy();
  });
});
