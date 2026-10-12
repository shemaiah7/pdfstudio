import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string) => ({ name: `${name}.pdf`, mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)) });

test("a JBIG2 scan renders in the browser with the served wasm decoder", async ({ page }) => {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("jbig2"));
  const canvas = page.locator(".page canvas").first();
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d")!;
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0 && px[i] < 128) dark++;
    return dark / (c.width * c.height);
  }), { timeout: 30_000 }).toBeGreaterThan(0.003);
  expect(logs.filter((l) => /Jbig2Error|wasmUrl/.test(l))).toEqual([]);
});
