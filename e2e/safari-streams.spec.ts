import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string) => ({ name: `${name}.pdf`, mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)) });

// Safari's ReadableStream has no async iterator, and pdf.js reads page text with `for await` over one.
// Remove it before the app loads so Chromium behaves like Safari here.
test("page text works without ReadableStream async iteration (Safari)", async ({ page }) => {
  await page.addInitScript(() => {
    delete (ReadableStream.prototype as unknown as Record<PropertyKey, unknown>)[Symbol.asyncIterator];
    delete (ReadableStream.prototype as unknown as Record<PropertyKey, unknown>).values;
  });
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.setInputFiles('input[type="file"]', fixture("three"));
  await expect(page.locator(".page .textLayer span").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("tool-edit").click();
  const span = page.locator(".page").first().locator(".textLayer span").first();
  const b = (await span.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByTestId("line-field").first()).toBeVisible();
  expect(errors.filter((e) => e.includes("text layer failed"))).toEqual([]);
});
