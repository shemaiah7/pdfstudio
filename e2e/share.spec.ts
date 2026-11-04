import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string) => ({ name: `${name}.pdf`, mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)) });

test("Share hands one PDF File to navigator.share", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: { n: number; names: string[]; types: string[]; size: number }[] };
    w.__shared = [];
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", { value: async (d: ShareData) => { w.__shared.push({ n: d.files?.length ?? 0, names: (d.files ?? []).map((f) => f.name), types: (d.files ?? []).map((f) => f.type), size: d.files?.[0]?.size ?? 0 }); }, configurable: true });
  });
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("three"));
  await expect(page.locator(".page .textLayer span").first()).toBeVisible();
  await page.getByTestId("share").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length)).toBe(1);
  const rec = await page.evaluate(() => (window as unknown as { __shared: { n: number; names: string[]; types: string[]; size: number }[] }).__shared[0]);
  expect(rec.n).toBe(1);
  expect(rec.names).toEqual(["three-edited.pdf"]);
  expect(rec.types).toEqual(["application/pdf"]);
  expect(rec.size).toBeGreaterThan(100);
});
