import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string) => ({ name: `${name}.pdf`, mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)) });

test("Print rasterizes every page into #print-root and calls window.print", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: { pages: number; sized: boolean; imgs: number }[] };
    w.__prints = [];
    window.print = () => {
      const root = document.getElementById("print-root");
      const pages = [...(root?.querySelectorAll<HTMLElement>(".print-page") ?? [])];
      w.__prints.push({ pages: pages.length, sized: pages.every((p) => p.style.width.endsWith("in") && p.style.height.endsWith("in")), imgs: root?.querySelectorAll("img").length ?? 0 });
    };
  });
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("three"));
  await expect(page.locator(".page .textLayer span").first()).toBeVisible();
  await page.getByTestId("print").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: unknown[] }).__prints.length)).toBe(1);
  const rec = await page.evaluate(() => (window as unknown as { __prints: { pages: number; sized: boolean; imgs: number }[] }).__prints[0]);
  expect(rec).toEqual({ pages: 3, sized: true, imgs: 3 });
  // Under print media only #print-root is shown.
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".toolbar")).toBeHidden();
  await expect(page.locator("#print-root")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await expect(page.locator(".toolbar")).toBeVisible();
});

test("Ctrl+P opens the print path instead of the browser's own dialog", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __n: number }).__n = 0; window.print = () => { (window as unknown as { __n: number }).__n++; }; });
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("three"));
  await expect(page.locator(".page .textLayer span").first()).toBeVisible();
  await page.keyboard.press("Control+p");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __n: number }).__n)).toBe(1);
});
