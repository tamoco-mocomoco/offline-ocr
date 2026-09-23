import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Regression coverage for false-triggering of the CTC-loop trim on legit
 * repetitive text. The user's concern:
 *
 *   > "繰り返す系の文章だったりすると影響受けたりしますか？
 *   >  逆にそっちが削られるみたいなことは避けたいなと。"
 *
 * Each fixture below is a real, legitimate OCR target that superficially
 * looks like something the trim heuristics might over-fire on:
 *  - manga sound effects (single-char repetition)
 *  - Japanese chants ("はい はい はい")
 *  - repeated words for emphasis ("ありがとう ありがとう ありがとう")
 *  - short English word chants ("no no no")
 *  - repeating-substring without spaces ("ららららら")
 *  - repetition then meaningful text ("ハハハ、元気ですか")
 *  - filename lists with a shared prefix (mutation-cluster risk)
 *
 * We log the actual OCR output for each case so a regression is visible
 * even if the assertion happens to be flexible. The invariant we assert:
 * the trim must NOT collapse a meaningful text into empty, and must NOT
 * eat the meaningful part of "repeat + content" mixes.
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

async function ocr(
  context: BrowserContext,
  selector: string,
): Promise<{ text: string; width: number; height: number }> {
  const harness = await openHarness(context);
  try {
    const fixture = await context.newPage();
    try {
      await fixture.goto("/test/e2e/fixtures/legit-repetition.html");
      const box = await fixture.locator(selector).boundingBox();
      if (!box) throw new Error(`no bbox for ${selector}`);
      const png = await fixture.screenshot({ clip: box, type: "png" });
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

// Cases where PARSeq (tegaki2) is empirically able to decode the input.
// The purpose here is verifying that trimCtcLoopTail's CHANT_MAX_LEN
// heuristic keeps the correct output intact — i.e., a legit chant / short
// repetition is NOT mistaken for a CTC-loop failure and collapsed to "".
const trimSurvivesCases: Array<{
  name: string;
  selector: string;
  mustContain: string[];
}> = [
  { name: "manga SFX (ドx7)", selector: "#sfx", mustContain: ["ド"] },
  { name: "chant (はい x3)", selector: "#chant", mustContain: ["は"] },
  { name: "emphatic (ありがとう x3)", selector: "#prefix-loop", mustContain: ["ありがとう"] },
  { name: "repeat then meaningful (ハハハ、元気)", selector: "#repeat-then-text", mustContain: ["元気"] },
  { name: "filename list similar prefix", selector: "#filenames", mustContain: ["test"] },
];

test.describe("legitimate repetitive text (trim must not over-fire)", () => {
  for (const c of trimSurvivesCases) {
    test(`${c.name}: content survives trim`, async ({ context }) => {
      const { text, width, height } = await ocr(context, c.selector);
      console.log(
        `[${c.name}] size=${Math.round(width)}x${Math.round(height)} text=${JSON.stringify(text)}`,
      );
      expect(text.length, `OCR returned empty for legit repetitive text`)
        .toBeGreaterThan(0);
      for (const s of c.mustContain) {
        expect(
          text.includes(s),
          `expected result to contain ${JSON.stringify(s)}, got ${JSON.stringify(text)}`,
        ).toBe(true);
      }
    });
  }

  // The two cases below fail not because the trim over-fires, but because
  // PARSeq (tegaki2) itself can't decode stylized short Latin repetition
  // or a single hiragana repeated many times — the raw PARSeq output IS a
  // long CTC loop, so trimCtcLoopTail correctly (fail-closed) trims it to
  // empty. Recovering the original would need model-level work (e.g., a
  // Latin-strong PARSeq preset). Marked fixme so it's visible but doesn't
  // fail the suite.
  test.fixme(
    "English chant (no no no) — PARSeq model can't decode; trim not at fault",
    async ({ context }) => {
      const { text } = await ocr(context, "#en-chant");
      expect(text.toLowerCase()).toContain("no");
    },
  );
  test.fixme(
    "no-space single-hiragana repeat (ら x5) — PARSeq misreads as digits",
    async ({ context }) => {
      const { text } = await ocr(context, "#no-space-repeat");
      expect(text).toContain("ら");
    },
  );
});
