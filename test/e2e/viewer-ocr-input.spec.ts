import { test, expect, type TestInfo } from "@playwright/test";
import {
  captureOcrInput,
  dragOnCanvas,
  measureTint,
  openViewer,
  saveForInspection,
  svgToGrayscalePng,
} from "./helpers/viewer";

/**
 * What the viewer actually sends to the OCR pipeline.
 *
 * The viewer draws its selection UI (blue fill, dashed outline, corner
 * handles) on top of the image on screen, so the overlay must never leak into
 * the image handed to OCR — the edge padding would stretch the outline into
 * stripes. These specs load the real viewer page and inspect the image of the
 * intercepted `run-ocr` message.
 *
 * The fixture is pure grayscale, so any pixel with a color tint in the OCR
 * input can only come from the (blue) selection overlay.
 */

const FIXTURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="120" y="225" font-size="80" fill="#000000" font-family="sans-serif">オフライン処理</text>
</svg>`;

async function expectNoOverlay(
  png: Buffer,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await saveForInspection(png, testInfo, name);
  const tint = await measureTint(png);
  const pct = ((tint.tinted / tint.total) * 100).toFixed(1);
  expect(
    tint.tinted,
    `${name} (${tint.width}x${tint.height}) has ${tint.tinted} tinted px (${pct}%) — selection overlay leaked into it`,
  ).toBe(0);
}

test.describe("viewer: OCR input must not contain the selection overlay", () => {
  test("OCR whole image (control)", async ({ page }, testInfo) => {
    await openViewer(page, await svgToGrayscalePng(FIXTURE_SVG));
    await page.click("#btn-ocr-all");
    await expectNoOverlay(await captureOcrInput(page), testInfo, "ocr-all-input");
  });

  test("rectangular selection", async ({ page }, testInfo) => {
    await openViewer(page, await svgToGrayscalePng(FIXTURE_SVG));
    await page.click("#btn-select");
    await dragOnCanvas(page, [
      [60, 100],
      [740, 300],
    ]);
    await expectNoOverlay(await captureOcrInput(page), testInfo, "rect-input");
  });

  test("deskew & select (four corners)", async ({ page }, testInfo) => {
    await openViewer(page, await svgToGrayscalePng(FIXTURE_SVG));
    await page.click("#btn-quad-select");
    await page.click("#btn-quad-confirm");
    await expectNoOverlay(await captureOcrInput(page), testInfo, "quad-input");
  });

  test("deskew & select: corrected preview", async ({ page }, testInfo) => {
    await openViewer(page, await svgToGrayscalePng(FIXTURE_SVG));
    await page.click("#btn-quad-select");
    // The preview is rAF-coalesced; wait until it has real content.
    await page.waitForFunction(() => {
      const c = document.getElementById("quad-preview") as HTMLCanvasElement;
      return c.width > 2 && c.height > 2;
    });
    const dataUrl = await page.evaluate(() =>
      (document.getElementById("quad-preview") as HTMLCanvasElement).toDataURL(
        "image/png",
      ),
    );
    await expectNoOverlay(
      Buffer.from(dataUrl.split(",")[1], "base64"),
      testInfo,
      "quad-preview",
    );
  });
});
