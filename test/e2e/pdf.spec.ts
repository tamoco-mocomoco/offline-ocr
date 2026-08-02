import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * PDF loader E2E — the vitest suite covers the loader's structure in Node,
 * but rendering a page needs a real Canvas backend. These specs exercise
 * that in a Chromium page via the harness's `window.__pdf` bridge.
 */

async function openHarness(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.on("pageerror", (e) =>
    console.log(`[harness pageerror] ${e.message}`),
  );
  await page.goto("/test/e2e/harness/index.html");
  await page.waitForFunction(() => window.__pdf !== undefined);
  return page;
}

test.describe("PDF loader (browser)", () => {
  test("loads a 3-page PDF and reports the correct pageCount", async ({
    context,
  }) => {
    const harness = await openHarness(context);
    const pageCount = await harness.evaluate(async () => {
      const doc = await window.__pdf.loadFromUrl(
        "/test/e2e/fixtures/hello-3page.pdf",
      );
      const n = doc.pageCount;
      await doc.destroy();
      return n;
    });
    expect(pageCount).toBe(3);
    await harness.close();
  });

  test("renders a page to a non-empty PNG blob", async ({ context }) => {
    const harness = await openHarness(context);
    const result = await harness.evaluate(async () => {
      const doc = await window.__pdf.loadFromUrl(
        "/test/e2e/fixtures/hello-3page.pdf",
      );
      const page = await doc.renderPage(1);
      await doc.destroy();
      return {
        width: page.width,
        height: page.height,
        byteLength: page.bytes.length,
        // First 8 bytes should be the PNG signature 89 50 4E 47 0D 0A 1A 0A
        signature: page.bytes.slice(0, 8),
      };
    });
    expect(result.byteLength).toBeGreaterThan(100);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    await harness.close();
  });

  test("throws PdfPasswordError for a password-protected PDF", async ({
    context,
  }) => {
    const harness = await openHarness(context);
    const wasPasswordError = await harness.evaluate(() =>
      window.__pdf.expectPasswordError(
        "/test/e2e/fixtures/password-protected.pdf",
      ),
    );
    expect(wasPasswordError).toBe(true);
    await harness.close();
  });

  test("throws PdfLoadError for garbage bytes", async ({ context }) => {
    const harness = await openHarness(context);
    const wasLoadError = await harness.evaluate(() =>
      window.__pdf.expectLoadError([1, 2, 3, 4, 5, 6, 7, 8]),
    );
    expect(wasLoadError).toBe(true);
    await harness.close();
  });

  test("renders different pages independently", async ({ context }) => {
    const harness = await openHarness(context);
    const result = await harness.evaluate(async () => {
      const doc = await window.__pdf.loadFromUrl(
        "/test/e2e/fixtures/hello-3page.pdf",
      );
      const p1 = await doc.renderPage(1);
      const p2 = await doc.renderPage(2);
      await doc.destroy();
      // Compare first 200 bytes as a cheap "images differ" check; the
      // rendered content is different (page 1 vs page 2) so PNG bytes
      // should differ even after the same header prefix.
      const p1Head = p1.bytes.slice(0, 200).join(",");
      const p2Head = p2.bytes.slice(0, 200).join(",");
      return { p1Len: p1.bytes.length, p2Len: p2.bytes.length, differ: p1Head !== p2Head };
    });
    expect(result.p1Len).toBeGreaterThan(100);
    expect(result.p2Len).toBeGreaterThan(100);
    expect(result.differ).toBe(true);
    await harness.close();
  });
});
