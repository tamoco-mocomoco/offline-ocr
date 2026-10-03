import { test, expect, type BrowserContext, type Page } from "@playwright/test";

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

test.describe("perspective transform (four-corner selection)", () => {
  test("unwarping a photographed-page fixture recovers the text", async ({
    context,
  }) => {
    const harness = await openHarness(context);
    const fixture = await context.newPage();
    try {
      await fixture.goto("/test/e2e/fixtures/perspective.html");
      await fixture.waitForFunction(
        () => typeof window.__cornersInViewport === "function",
      );

      // Full-page screenshot so the corner coordinates from the fixture
      // (viewport coords) index directly into the PNG.
      const png = await fixture.screenshot({ type: "png", fullPage: false });
      // Grab the four transformed corners of #target in viewport coords.
      const corners = await fixture.evaluate(() =>
        (
          window as unknown as {
            __cornersInViewport: () => { x: number; y: number }[];
          }
        ).__cornersInViewport(),
      );
      expect(corners).toHaveLength(4);

      // Scale corners by devicePixelRatio if Playwright reports one.
      const dpr = await fixture.evaluate(() => window.devicePixelRatio || 1);
      const scaled = corners.map((p) => ({ x: p.x * dpr, y: p.y * dpr })) as [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ];

      // Warp the quad back to an axis-aligned rectangle using the same
      // perspective code the viewer uses.
      const unwarped = await harness.evaluate(
        async ({ bytes, cornersArg }) =>
          await window.__warp.unwarp(bytes, cornersArg),
        { bytes: Array.from(png), cornersArg: scaled },
      );
      expect(unwarped.width).toBeGreaterThan(200);
      expect(unwarped.height).toBeGreaterThan(100);

      // Feed the unwarped image through the real OCR pipeline.
      const result = await harness.evaluate(
        async (bytes) => await window.__ocr.run(bytes),
        unwarped.bytes,
      );
      // The fixture text is "オフライン処理" — assert enough of it survives
      // OCR that we can call the corrected recognition successful.
      expect(result.text).toContain("オフライン");
    } finally {
      await fixture.close();
      await harness.close();
    }
  });
});
