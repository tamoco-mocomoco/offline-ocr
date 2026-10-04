import { test, expect, type Page } from "@playwright/test";
import {
  captureOcrInput,
  countDiffering,
  dragOnCanvas,
  inkBox,
  measureTint,
  openViewer,
  readRaw,
  saveForInspection,
  svgToGrayscalePng,
  type Box,
  type Raw,
} from "./helpers/viewer";

/**
 * Viewer eraser: strokes painted over the image must reach the OCR input
 * (filled with the local background color), and undo / restore-all must bring
 * the original pixels back.
 */

const W = 800;
const H = 400;
const TOP: Box = { x0: 0, y0: 0, x1: W, y1: H / 2 };
const BOTTOM: Box = { x0: 0, y0: H / 2, x1: W, y1: H };

function twoLines(bg: string, fg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="${bg}"/>
    <text x="100" y="140" font-size="64" fill="${fg}" font-family="sans-serif">残しておく行</text>
    <text x="100" y="310" font-size="64" fill="${fg}" font-family="sans-serif">消してしまう行</text>
  </svg>`;
}

/** One continuous zigzag stroke covering `box` with a margin. */
async function eraseBox(page: Page, box: Box): Promise<void> {
  const left = box.x0 - 20;
  const right = box.x1 + 20;
  const points: Array<[number, number]> = [];
  let y = box.y0 - 10;
  let toRight = true;
  while (y <= box.y1 + 10) {
    points.push([toRight ? left : right, y], [toRight ? right : left, y]);
    toRight = !toRight;
    y += 20;
  }
  await dragOnCanvas(page, points);
}

/**
 * The OCR input of "OCR Entire Image" is the image plus equal edge padding on
 * every side; return it with that padding cropped off so boxes from the
 * fixture line up.
 */
async function ocrAllInput(page: Page, nth: number): Promise<{ png: Buffer; raw: Raw }> {
  await page.click("#btn-ocr-all");
  const png = await captureOcrInput(page, nth);
  const padded = await readRaw(png);
  const pad = (padded.width - W) / 2;
  expect(pad).toBe((padded.height - H) / 2);
  const data = Buffer.alloc(W * H * padded.channels);
  for (let y = 0; y < H; y++) {
    const from = ((y + pad) * padded.width + pad) * padded.channels;
    padded.data.copy(data, y * W * padded.channels, from, from + W * padded.channels);
  }
  return { png, raw: { data, width: W, height: H, channels: padded.channels } };
}

async function setup(page: Page, bg: string, fg: string) {
  const png = await svgToGrayscalePng(twoLines(bg, fg));
  const fixture = await readRaw(png);
  const dark = fg < bg; // "#000000" < "#ffffff"
  // inkBox looks for dark pixels; for light text on dark, look at the inverse.
  const inv: Raw = dark
    ? fixture
    : { ...fixture, data: Buffer.from(fixture.data.map((v) => 255 - v)) };
  const top = inkBox(inv, TOP);
  const bottom = inkBox(inv, BOTTOM);
  if (!top || !bottom) throw new Error("fixture text did not render");
  await openViewer(page, png);
  return { top, bottom };
}

test.describe("viewer eraser", () => {
  test("erased text is filled with the background and no longer OCR'd", async ({
    page,
  }, testInfo) => {
    const { top, bottom } = await setup(page, "#ffffff", "#000000");
    await page.click("#btn-erase");
    await page.click('.eraser-size[data-size="l"]');
    await eraseBox(page, bottom);
    await expect(page.locator("#btn-erase-undo")).toBeEnabled();

    const { png, raw } = await ocrAllInput(page, 0);
    await saveForInspection(png, testInfo, "erased-input");
    // The bottom line is gone: every pixel there is the white background…
    expect(countDiffering(raw, bottom, 255, 2)).toBe(0);
    // …the top line is untouched…
    expect(inkBox(raw, top)).toEqual(top);
    // …and neither the eraser cursor nor any other UI leaked in.
    expect((await measureTint(png)).tinted).toBe(0);

    // Through the real OCR pipeline: only the kept line is read.
    const harness = await page.context().newPage();
    try {
      await harness.goto("/test/e2e/harness/index.html");
      await harness.waitForFunction(() => window.__ocr !== undefined);
      await harness.evaluate(() => window.__ocr.whenReady());
      const result = await harness.evaluate(
        async (bytes) => await window.__ocr.run(bytes),
        Array.from(png),
      );
      expect(result.text).toContain("残して");
      expect(result.text).not.toContain("消して");
    } finally {
      await harness.close();
    }
  });

  test("on a dark page the erased area takes the dark background color", async ({
    page,
  }, testInfo) => {
    const { bottom } = await setup(page, "#202020", "#e0e0e0");
    await page.click("#btn-erase");
    await page.click('.eraser-size[data-size="l"]');
    await eraseBox(page, bottom);
    const { png, raw } = await ocrAllInput(page, 0);
    await saveForInspection(png, testInfo, "dark-erased-input");
    expect(countDiffering(raw, bottom, 0x20, 2)).toBe(0);
  });

  test("Ctrl+Z undoes the last stroke and 'Restore all' undoes the rest", async ({
    page,
  }) => {
    const { top, bottom } = await setup(page, "#ffffff", "#000000");
    await page.click("#btn-erase");
    await page.click('.eraser-size[data-size="l"]');
    await eraseBox(page, bottom);
    await eraseBox(page, top);
    // Leaving the eraser keeps the edits.
    await page.keyboard.press("Escape");
    await expect(page.locator("#eraser-tools")).toBeHidden();

    await page.keyboard.press("Control+z");
    const afterUndo = (await ocrAllInput(page, 0)).raw;
    expect(inkBox(afterUndo, top)).toEqual(top); // last stroke undone
    expect(countDiffering(afterUndo, bottom, 255, 2)).toBe(0); // first still erased

    await page.click("#btn-erase");
    await page.click("#btn-erase-reset");
    await expect(page.locator("#btn-erase-undo")).toBeDisabled();
    await expect(page.locator("#btn-erase-reset")).toBeDisabled();
    const afterReset = (await ocrAllInput(page, 1)).raw;
    expect(inkBox(afterReset, top)).toEqual(top);
    expect(inkBox(afterReset, bottom)).toEqual(bottom);
  });

  test("rectangle selection after erasing reads the erased image", async ({
    page,
  }, testInfo) => {
    const { bottom } = await setup(page, "#ffffff", "#000000");
    await page.click("#btn-erase");
    await page.click('.eraser-size[data-size="l"]');
    await eraseBox(page, bottom);
    await page.click("#btn-select");
    await expect(page.locator("#eraser-tools")).toBeHidden();
    await dragOnCanvas(page, [
      [bottom.x0 - 10, bottom.y0 - 10],
      [bottom.x1 + 10, bottom.y1 + 10],
    ]);
    const png = await captureOcrInput(page);
    await saveForInspection(png, testInfo, "rect-after-erase-input");
    const raw = await readRaw(png);
    expect(inkBox(raw, { x0: 0, y0: 0, x1: raw.width, y1: raw.height })).toBeNull();
    expect((await measureTint(png)).tinted).toBe(0);
  });
});
