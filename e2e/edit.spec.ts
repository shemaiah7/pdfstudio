import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string) => ({ name: `${name}.pdf`, mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)) });
async function savedText(page: import("@playwright/test").Page): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const bytes = readFileSync((await download.path()) as string);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const tc = await (await pdf.getPage(1)).getTextContent();
  return tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
}

const selectAll = (editor: import("@playwright/test").Locator) =>
  editor.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection()!; s.removeAllRanges(); s.addRange(r); });

test("edit a typed line in place and download", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("three"));
  await expect(page.locator(".page .textLayer span").first()).toBeVisible();
  await page.getByTestId("tool-edit").click();
  const span = page.locator(".page").first().locator(".textLayer span", { hasText: "three:0" });
  const b = await span.boundingBox();
  await page.mouse.click(b!.x + 5, b!.y + b!.height / 2);
  const editor = page.getByTestId("block-editor");
  await expect(editor).toHaveText("three:0");
  await selectAll(editor);
  await editor.type("thre:9");
  await editor.press("Enter");
  await expect(page.locator(".edit-line").first()).toHaveText("thre:9");
  const text = await savedText(page);
  expect(text).toContain("thre:9");
  // Edited native pages are flattened on export, so the covered original is gone.
  expect(text).not.toContain("three:0");
});

test.describe("scan", () => {
  test.skip(!process.env.E2E_OCR, "set E2E_OCR=1 (downloads Tesseract)");
  test("edit a recognized word on a scan", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture("scan"));
    await expect(page.getByTestId("ocr-badge").first()).toHaveText("Text recognized", { timeout: 120_000 });
    await page.getByTestId("tool-edit").click();
    const span = page.locator(".page .textLayer span", { hasText: /hypertension/i }).first();
    const b = await span.boundingBox();
    await page.mouse.click(b!.x + 5, b!.y + b!.height / 2);
    const editor = page.getByTestId("block-editor");
    await expect(editor).toContainText(/hypertension/i);
    // Select just the word: the block is multi-line and typing "\n" would press Enter (apply).
    await editor.evaluate((el) => {
      const node = el.firstChild!;
      const i = node.textContent!.search(/hypertension/i);
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + "hypertension".length);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await editor.type("hypotension");
    await editor.press("Enter");
    await expect(page.locator(".edit-line", { hasText: "hypotension" })).toBeVisible();
    const text = await savedText(page);
    expect(text).toMatch(/hypotension/i);
    expect(text).not.toMatch(/hypertension/i);
  });
});
