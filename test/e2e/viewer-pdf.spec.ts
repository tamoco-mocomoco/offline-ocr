import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { stubChrome } from "./helpers/viewer";

/**
 * The extension ships pdf.js's modern build, which calls recent APIs (newest:
 * Math.sumPrecise, Chrome 147) without feature checks. The viewer must open
 * PDFs on a current Chrome and, on an older one, tell the user to update
 * instead of failing inside pdf.js.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PDF = readFileSync(resolve(HERE, "fixtures/hello-3page.pdf"));

test.describe("viewer: opening a PDF", () => {
  test("renders the first page on a current Chrome", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await stubChrome(page);
    await page.goto("/src/viewer/viewer.html");
    await page.setInputFiles("#file-input", {
      name: "hello.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(page.locator("#canvas")).toBeVisible();
    await expect(page.locator("#pdf-nav")).toHaveClass(/active/);
    await expect(page.locator("#status")).toContainText("page 1 / 3");
    expect(errors).toEqual([]);
  });

  test("asks to update Chrome when the APIs pdf.js needs are missing", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      delete (Math as unknown as { sumPrecise?: unknown }).sumPrecise;
    });
    await stubChrome(page);
    await page.goto("/src/viewer/viewer.html");
    await page.setInputFiles("#file-input", {
      name: "hello.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(page.locator("#toast")).toContainText("Chrome 147");
    await expect(page.locator("#canvas")).toBeHidden();
  });
});
