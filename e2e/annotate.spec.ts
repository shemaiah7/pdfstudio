import { test, expect } from "@playwright/test";
import { PDFDocument, PDFName } from "pdf-lib";
import { readFileSync } from "node:fs";

test("draw, rectangle, fill a field, download", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', "src/test/fixtures/form.pdf");
  await page.waitForFunction(() => document.querySelectorAll(".page canvas[style*='height']").length >= 1);
  const pg = page.locator(".pageview .page").first();
  const box = (await pg.boundingBox())!;
  await page.getByTestId("tool-ink").click();
  await page.mouse.move(box.x + 50, box.y + 50); await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 90, { steps: 8 }); await page.mouse.up();
  await page.getByTestId("tool-rect").click();
  await page.mouse.move(box.x + 150, box.y + 150); await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 220, { steps: 5 }); await page.mouse.up();
  await page.getByTestId("tool-select").click();
  await page.locator('[data-field="name"]').fill("Grace");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const bytes = readFileSync((await download.path())!);
  const doc = await PDFDocument.load(bytes);
  const subtypes = doc.getPage(0).node.Annots()!.asArray().map((r) => String((doc.context.lookup(r) as any).get(PDFName.of("Subtype"))));
  expect(subtypes).toContain("/Ink");
  expect(subtypes).toContain("/Square");
  expect(doc.getForm().getTextField("name").getText()).toBe("Grace");
});
