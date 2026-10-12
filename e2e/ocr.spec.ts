// e2e/ocr.spec.ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test.skip(!process.env.E2E_OCR, "set E2E_OCR=1 to run the OCR tests (downloads Tesseract from jsDelivr)");

const scan = () => ({ name: "scan.pdf", mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures/scan.pdf")) });

test("recognizes a scanned page, makes it selectable, and summarizes it", async ({ page }) => {
  test.setTimeout(180_000);
  await page.route("**/session", (r) => r.fulfill({ json: { token: "t", expiresAt: 9999999999 } }));
  await page.route("**/ai", (r) => r.fulfill({ headers: { "content-type": "text/event-stream" }, body: 'event: delta\ndata: {"text":"Summary of the scan."}\n\nevent: done\ndata: {"usage":{"input":1,"output":1},"stop":"end_turn","remaining":{"requests":19,"tokens":1},"resetAt":0}\n\n' }));
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', scan());
  await expect(page.getByTestId("ocr-badge").first()).toHaveText("Text recognized", { timeout: 120_000 });
  await expect(page.locator(".page .textLayer span").first()).toBeVisible();
  await expect(page.locator(".page .textLayer")).toContainText(/hypertension/i);
  await page.getByTestId("panel-tab-ai").click();
  await page.getByTestId("ai-tab-summarize").click();
  await page.getByTestId("ai-run").click();
  await expect(page.getByText("Summary of the scan.")).toBeVisible({ timeout: 30_000 });
});

test("Deep OCR against a mocked worker replaces the page text", async ({ page }) => {
  test.setTimeout(180_000);
  await page.route("**/session", (r) => r.fulfill({ json: { token: "t", expiresAt: 9999999999 } }));
  await page.route("**/ocr", (r) => r.fulfill({ json: { pages: [{ page: 1, lines: ["Handwritten order: hold warfarin"] }], failed: [], remaining: { requests: 18, tokens: 1 }, resetAt: 0 } }));
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', scan());
  await expect(page.getByTestId("ocr-badge").first()).toHaveText("Text recognized", { timeout: 120_000 });
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("deep-ocr").locator("summary").click();
  await page.getByRole("button", { name: "This page" }).click();
  await expect(page.getByTestId("ocr-badge").first()).toHaveText("Deep OCR", { timeout: 30_000 });
  await expect(page.locator(".page .textLayer")).toContainText("warfarin");
});

test("downloaded PDF contains the recognized words", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', scan());
  await expect(page.getByTestId("ocr-badge").first()).toHaveText("Text recognized", { timeout: 120_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const bytes = readFileSync(await download.path() as string);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
  expect(text).toMatch(/hypertension/i);
});

test("recognizes while the tab is hidden (requestAnimationFrame never fires)", async ({ page }) => {
  // Chrome suspends requestAnimationFrame in background tabs; pdf.js paces default-intent renders with it.
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden" });
    window.requestAnimationFrame = () => 0;
  });
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', scan());
  await expect(page.getByTestId("ocr-badge").first()).toHaveText("Text recognized", { timeout: 120_000 });
});
