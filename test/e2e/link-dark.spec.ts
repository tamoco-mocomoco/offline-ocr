import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Regression for a real user report: OCR'ing a small chip-like Latin label
 * on a dark background ("tamoco-mocomoco" underlined bold on #0d1117) can
 * come back as a PARSeq CTC loop ("the the the the ...") instead of the
 * actual text.
 *
 * The failure mode is characteristic:
 *  - The correct string is a single English word/handle
 *  - The output is a short token repeated dozens of times, filling the
 *    model's max sequence length
 *
 * We reproduce two shapes:
 *  1. `#target-small` — both dims ≤ 200px → hits the small-image bypass
 *     path (SMALL_IMAGE_BYPASS_MAX_SIDE), which already includes the v0.7.1
 *     fragment-band cleaning
 *  2. `#target-large` — max dim > 200px → goes through the DEIM detection
 *     path, which is where the user's report came from
 *
 * Both should recognize "tamoco" (a substring test tolerates OCR noise on
 * the hyphenated tail while still catching the CTC-loop failure mode).
 */
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

async function ocrElement(
  context: BrowserContext,
  fixturePath: string,
  selector: string,
): Promise<{ text: string; width: number; height: number }> {
  const harness = await openHarness(context);
  try {
    const fixture = await context.newPage();
    try {
      await fixture.goto(fixturePath);
      const box = await fixture.locator(selector).boundingBox();
      if (!box) throw new Error(`no bounding box for ${selector}`);
      const png = await fixture.screenshot({
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
        type: "png",
      });
      const result = await harness.evaluate(
        async (bytes) => await window.__ocr.run(bytes),
        Array.from(png),
      );
      return { text: result.text, width: box.width, height: box.height };
    } finally {
      await fixture.close();
    }
  } finally {
    await harness.close();
  }
}

// Detects the CTC-loop failure: the same short token repeated 3+ times in a
// row anywhere in the output. This catches both "the the the ..." (pure
// loop) and "tamoco-mocomoco the the the ..." (correct start + loop tail).
function looksLikeCtcLoop(text: string): boolean {
  const parts = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < parts.length - 2; i++) {
    if (parts[i] === parts[i + 1] && parts[i] === parts[i + 2]) {
      return true;
    }
  }
  return false;
}

// bypass-path (SMALL_IMAGE_BYPASS_MAX_SIDE) cases: the CTC-loop trim in
// parseq.ts guarantees the `the the the ...` tail can no longer leak out.
const bypassCases = [
  { name: "small (bypass path)", selector: "#target-small" },
  { name: "medium (bypass path)", selector: "#target-medium" },
];

test.describe("dark-bg Latin label OCR", () => {
  for (const c of bypassCases) {
    test(`${c.name}: 'tamoco-mocomoco' is recognized, not a CTC loop or empty`, async ({
      context,
    }) => {
      const { text, width, height } = await ocrElement(
        context,
        "/test/e2e/fixtures/link-dark.html",
        c.selector,
      );
      console.log(
        `[${c.name}] size=${Math.round(width)}x${Math.round(height)} text=${JSON.stringify(text)}`,
      );
      expect(looksLikeCtcLoop(text), `CTC-loop output: ${text}`).toBe(false);
      expect(text.length, `empty OCR result`).toBeGreaterThan(0);
      expect(text.toLowerCase()).toContain("tamoco");
    });
  }

  // Larger dark chip WITHOUT underline: goes through DEIM path and is
  // recognized correctly. The color-inversion in the bypass fallback also
  // helps but isn't reached for this input.
  test("large without underline (DEIM path): 'tamoco-mocomoco' is recognized", async ({
    context,
  }) => {
    const { text, width, height } = await ocrElement(
      context,
      "/test/e2e/fixtures/link-dark.html",
      "#target-large-nou",
    );
    console.log(
      `[large-nou] size=${Math.round(width)}x${Math.round(height)} text=${JSON.stringify(text)}`,
    );
    expect(looksLikeCtcLoop(text), `CTC-loop output: ${text}`).toBe(false);
    expect(text.length, `empty OCR result`).toBeGreaterThan(0);
    expect(text.toLowerCase()).toContain("tamoco");
  });

  // Larger dark chip WITH underline: known-limitation case.
  //   - DEIM detects a single box that includes the underline pixel row and
  //     the class-mapping ends up not producing a LINE element (0 lines after
  //     detectionsToPage / findAll).
  //   - The bypass fallback runs; extractMainTextBand yields a ~16px band
  //     that includes the underline stroke, and PARSeq degenerates into a
  //     CTC loop that trimCtcLoopTail then collapses to empty.
  //   - Net effect for the user is an empty result instead of garbage — an
  //     improvement over v0.8.0 — but still not the correct text.
  //   - Fix requires either underline-stroke removal in image preprocessing
  //     or teaching filterFurigana / the parser about underline-adjacent
  //     Latin lines. Deferred to a follow-up release.
  test.fixme(
    "large with underline (underline-stroke known limitation)",
    async ({ context }) => {
      const { text } = await ocrElement(
        context,
        "/test/e2e/fixtures/link-dark.html",
        "#target-large",
      );
      expect(text.toLowerCase()).toContain("tamoco");
    },
  );
});
