/**
 * Helpers for E2E specs that drive the real viewer page
 * (src/viewer/viewer.html) from the Vite dev server.
 *
 * The viewer runs as a chrome-extension:// page in production; here the
 * `chrome` APIs it touches are replaced with in-page recorders, so a spec can
 * read the exact image the viewer hands to OCR (the `run-ocr` message)
 * without loading the extension.
 */

import { expect, type Page, type TestInfo } from "@playwright/test";
import sharp from "sharp";

// Max channel spread (max(r,g,b) - min(r,g,b)) still counted as "gray".
// The selection fill over white is ~18; outlines, handles and the eraser
// cursor are >100.
export const TINT_TOLERANCE = 8;

export type Box = { x0: number; y0: number; x1: number; y1: number };

export type Raw = {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
};

export async function svgToGrayscalePng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).grayscale().png().toBuffer();
}

export async function readRaw(png: Buffer): Promise<Raw> {
  const { data, info } = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Bounding box of pixels darker than `threshold` (first channel) inside `within`. */
export function inkBox(raw: Raw, within: Box, threshold = 128): Box | null {
  let box: Box | null = null;
  for (let y = within.y0; y < within.y1; y++) {
    for (let x = within.x0; x < within.x1; x++) {
      if (raw.data[(y * raw.width + x) * raw.channels] >= threshold) continue;
      if (!box) box = { x0: x, y0: y, x1: x + 1, y1: y + 1 };
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x + 1);
      box.y1 = Math.max(box.y1, y + 1);
    }
  }
  return box;
}

/** Pixels inside `box` whose channels differ from `color` by more than `tol`. */
export function countDiffering(
  raw: Raw,
  box: Box,
  color: number,
  tol: number,
): number {
  let n = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * raw.width + x) * raw.channels;
      for (let c = 0; c < 3; c++) {
        if (Math.abs(raw.data[i + c] - color) > tol) {
          n++;
          break;
        }
      }
    }
  }
  return n;
}

export async function measureTint(
  png: Buffer,
): Promise<{ tinted: number; total: number; width: number; height: number }> {
  const raw = await readRaw(png);
  let tinted = 0;
  for (let i = 0; i < raw.data.length; i += raw.channels) {
    const r = raw.data[i];
    const g = raw.data[i + 1];
    const b = raw.data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > TINT_TOLERANCE) tinted++;
  }
  return {
    tinted,
    total: raw.width * raw.height,
    width: raw.width,
    height: raw.height,
  };
}

/** Replace the extension APIs the viewer touches with in-page recorders. */
async function stubChrome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sent: unknown[] = [];
    const w = window as unknown as Record<string, unknown>;
    w.__sent = sent;
    Object.defineProperty(window, "chrome", {
      configurable: true,
      writable: true,
      value: {
        i18n: { getMessage: () => "" },
        tabs: { getCurrent: async () => ({ id: 1 }) },
        runtime: {
          sendMessage: async (m: unknown) => {
            sent.push(m);
          },
          // Pretend the offscreen document already exists.
          getContexts: async () => [{}],
          onMessage: { addListener: () => {} },
        },
        offscreen: { createDocument: async () => {} },
        storage: {
          session: { get: async () => ({}), remove: async () => {} },
          sync: { get: async () => ({}), set: async () => {} },
          local: {
            get: async () => ({}),
            set: async () => {},
            remove: async () => {},
          },
        },
      },
    });
  });
}

export async function openViewer(page: Page, png: Buffer): Promise<void> {
  page.on("pageerror", (e) => console.log(`[viewer pageerror] ${e.message}`));
  await stubChrome(page);
  await page.goto("/src/viewer/viewer.html");
  await page.setInputFiles("#file-input", {
    name: "fixture.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.locator("#canvas")).toBeVisible();
  await expect(page.locator("#btn-select")).toBeEnabled();
}

/** Image-space (canvas pixel) → viewport coordinates. */
export async function toClient(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator("#canvas").boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  const size = await page.evaluate(() => {
    const c = document.getElementById("canvas") as HTMLCanvasElement;
    return { w: c.width, h: c.height };
  });
  return {
    x: box.x + (x * box.width) / size.w,
    y: box.y + (y * box.height) / size.h,
  };
}

/** Press, move through `points` (image coordinates), release: one drag. */
export async function dragOnCanvas(
  page: Page,
  points: Array<[number, number]>,
): Promise<void> {
  const first = await toClient(page, points[0][0], points[0][1]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) {
    const p = await toClient(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 8 });
  }
  await page.mouse.up();
}

/**
 * The image of the `nth` (0-based) `run-ocr` message the viewer sent, i.e.
 * exactly what the OCR pipeline would receive.
 */
export async function captureOcrInput(page: Page, nth = 0): Promise<Buffer> {
  const handle = await page.waitForFunction((n) => {
    const sent = (window as unknown as { __sent: Array<Record<string, unknown>> })
      .__sent;
    const msg = sent.filter((m) => m?.type === "run-ocr")[n];
    return msg ? (msg.screenshotDataUrl as string) : null;
  }, nth);
  const dataUrl = await handle.jsonValue();
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

/** Save `png` under test-results/ (and attach it) so failures can be inspected by eye. */
export async function saveForInspection(
  png: Buffer,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await sharp(png).toFile(path);
  await testInfo.attach(name, { path, contentType: "image/png" });
}
