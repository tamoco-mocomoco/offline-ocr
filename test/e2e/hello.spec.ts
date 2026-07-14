import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * OCR the region of a fixture page bounded by the given selector, then return
 * the joined text. Opens a fresh harness page per call — the harness owns the
 * OCR worker and models, and each test that needs it should call this helper.
 */
async function ocrRegion(
  context: BrowserContext,
  fixturePath: string,
  selector: string,
): Promise<{ text: string; lines: number }> {
  const harness = await openHarness(context);
  try {
    const fixture = await context.newPage();
    try {
      await fixture.goto(fixturePath);
      const box = await fixture.locator(selector).boundingBox();
      if (!box) throw new Error(`element ${selector} has no bounding box`);
      const png = await fixture.screenshot({ clip: box, type: "png" });
      const result = await harness.evaluate(
        async (bytes) => await window.__ocr.run(bytes),
        Array.from(png),
      );
      return { text: result.text, lines: result.lines.length };
    } finally {
      await fixture.close();
    }
  } finally {
    await harness.close();
  }
}

async function openHarness(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.on("pageerror", (e) =>
    console.log(`[harness pageerror] ${e.message}`),
  );
  await page.goto("/test/e2e/harness/index.html");
  await page.waitForFunction(() => window.__ocr !== undefined);
  await page.evaluate(() => window.__ocr.whenReady());
  return page;
}

test.describe("OCR pipeline", () => {
  test("bypass path: small selection with a short text line", async ({
    context,
  }) => {
    const { text } = await ocrRegion(
      context,
      "/test/e2e/fixtures/hello.html",
      "#target",
    );
    expect(text).toContain("こんにちは");
  });

  test("DEIM path: larger selection with multiple lines", async ({
    context,
  }) => {
    const { text, lines } = await ocrRegion(
      context,
      "/test/e2e/fixtures/paragraph.html",
      "#target",
    );
    // Multi-line paragraph should produce >= 2 detected lines.
    expect(lines).toBeGreaterThanOrEqual(2);
    expect(text).toContain("オフライン");
    expect(text).toContain("通信");
  });

  test("clipboard round-trip: writeText/readText from the fixture page", async ({
    context,
  }) => {
    const harness = await openHarness(context);
    const fixture = await context.newPage();
    await fixture.goto("/test/e2e/fixtures/hello.html");
    const box = await fixture.locator("#target").boundingBox();
    if (!box) throw new Error("target not found");
    const png = await fixture.screenshot({ clip: box, type: "png" });

    const result = await harness.evaluate(
      async (bytes) => await window.__ocr.run(bytes),
      Array.from(png),
    );

    await fixture.evaluate(
      (t) => navigator.clipboard.writeText(t),
      result.text,
    );
    const clipboard = await fixture.evaluate(() =>
      navigator.clipboard.readText(),
    );

    expect(clipboard).toBe(result.text);
    expect(clipboard).toContain("こんにちは");

    await fixture.close();
    await harness.close();
  });
});
