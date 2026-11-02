import { test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * 手元の画像を、拡張と同じ OCR に通して結果を表示する (検品用。OCR_IMAGES がなければ何もしない)。
 * 画像生成で作った絵の文字が本当に読めるかを、サイトや動画に載せる前に確かめるのに使う。
 *
 *   OCR_IMAGES="a.png;b.png:x,y,w,h" npm run test:e2e -- ocr-images
 *
 * `:x,y,w,h` を付けると、その範囲を切り抜いてから OCR する (範囲選択と同じ)。
 */
test("OCR local images", async ({ context }) => {
  const specs = (process.env.OCR_IMAGES ?? "").split(";").filter(Boolean);
  test.skip(specs.length === 0, "OCR_IMAGES is not set");
  const page = await context.newPage();
  await page.goto("/test/e2e/harness/index.html");
  await page.waitForFunction(() => window.__ocr !== undefined);
  await page.evaluate(() => window.__ocr.whenReady());
  for (const spec of specs) {
    const [file, box] = spec.split(":");
    let bytes = readFileSync(file);
    if (box) {
      const [x, y, w, h] = box.split(",").map(Number);
      const crop = await context.newPage();
      await crop.setContent(
        `<body style="margin:0"><div style="width:${w}px;height:${h}px;background:url(data:image/png;base64,${bytes.toString("base64")}) -${x}px -${y}px no-repeat"></div>`,
      );
      bytes = await crop.locator("div").screenshot({ type: "png" });
      await crop.close();
    }
    const r = await page.evaluate(async (b) => await window.__ocr.run(b), Array.from(bytes));
    console.log(`OCR ${file.split("/").pop()}${box ? ` [${box}]` : ""} => ${JSON.stringify(r.text)}`);
  }
});
