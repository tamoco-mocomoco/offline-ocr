import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * User-reported regression: OCR'ing a `CHANGELOG_ja.md` dark-bg chip in
 * Chrome returned mutation-loop garbage like:
 *   `CHANGELOG CHANGE CHAND CHAND CON R. CON S.IS.EO.IRES AND STION
 *    REREATERESTION OF S.ISTION`
 *
 * The HTML-fixture E2E in `link-dark.spec.ts` did NOT reproduce this because
 * the font/subpixel rendering in Playwright's headless Chromium differed
 * from the user's Chrome, and my synthesized HTML rendered cleaner glyphs
 * that PARSeq could read.
 *
 * This spec loads the user's exact PNG bytes (`user-report-changelog.png`,
 * 190×68) directly into the OCR pipeline via the harness — no HTML rendering
 * in between — so the failure mode is fully preserved.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, "fixtures/user-report-changelog.png");

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

// Same detector used in link-dark.spec.ts — catches whitespace-token loops
// AND character-level substring loops (like `.ES.ES.ES`).
function looksLikeCtcLoop(text: string): boolean {
  const parts = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < parts.length - 2; i++) {
    if (parts[i] === parts[i + 1] && parts[i] === parts[i + 2]) return true;
  }
  for (let len = 2; len <= 10; len++) {
    for (let start = 0; start + 3 * len <= text.length; start++) {
      const s = text.slice(start, start + len);
      if (s.trim().length === 0) continue;
      if (
        text.slice(start + len, start + 2 * len) === s &&
        text.slice(start + 2 * len, start + 3 * len) === s
      ) {
        return true;
      }
    }
  }
  return false;
}

test.describe("user-reported CHANGELOG_ja.md dark chip (real PNG)", () => {
  test("OCR of the actual user PNG does not leak CTC/mutation-loop garbage", async ({
    context,
  }) => {
    const harness = await openHarness(context);
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const result = await harness.evaluate(
      async (b) => await window.__ocr.run(b),
      Array.from(bytes),
    );
    console.log(
      `[user PNG] size=190x68 text=${JSON.stringify(result.text)}`,
    );
    // Hard invariants that MUST hold — regardless of whether the correct
    // filename is recovered, these garbage patterns from the user's report
    // must never surface again:
    expect(looksLikeCtcLoop(result.text), `CTC loop leaked: ${result.text}`)
      .toBe(false);
    // Specific mutation-loop tokens the user actually saw
    expect(result.text).not.toMatch(/CHAND CON/i);
    expect(result.text).not.toMatch(/S\.ES/i);
    expect(result.text).not.toMatch(/S\.IS/i);
    expect(result.text).not.toMatch(/REREATE/i);
    expect(result.text).not.toMatch(/STION STION/i);
    // Correctness aspiration: at minimum the "CHANGELOG" prefix should be
    // present. If this becomes flaky it's a signal we're regressing on the
    // dark-chip fixes.
    expect(result.text.toUpperCase()).toContain("CHANGELOG");
    await harness.close();
  });
});
