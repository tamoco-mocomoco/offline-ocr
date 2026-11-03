/**
 * screenshots.html をストアに出す画像にする。
 *
 *   node store/listing/render.mjs        # out/ja/ と out/en/ に slide1〜5.png、promo-small.png、promo-marquee.png
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAMES = { s1: "slide1", s2: "slide2", s3: "slide3", s4: "slide4", s5: "slide5", small: "promo-small", marquee: "promo-marquee" };
const browser = await chromium.launch();
for (const lang of ["ja", "en"]) {
  const out = resolve(HERE, "out", lang);
  mkdirSync(out, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(`file://${resolve(HERE, "screenshots.html")}?lang=${lang}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  for (const [id, name] of Object.entries(NAMES)) {
    await page.locator(`#${id}`).screenshot({ path: resolve(out, `${name}.png`) });
  }
  await page.close();
  console.log(out);
}
await browser.close();
