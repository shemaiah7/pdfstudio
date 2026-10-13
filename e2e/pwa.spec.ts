import { test, expect } from "@playwright/test";

const ORIGIN = "http://localhost:5299";

test("manifest is valid and its icons load", async ({ request }) => {
  const res = await request.get(`${ORIGIN}/manifest.webmanifest`);
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toBe("PDF Studio");
  expect(m.display).toBe("standalone");
  expect(m.icons).toHaveLength(3);
  for (const icon of m.icons) {
    const r = await request.get(`${ORIGIN}${icon.src}`);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
});

test("service worker takes over and the empty state loads offline", async ({ page, context }) => {
  await page.goto(`${ORIGIN}/`);
  await expect(page.getByTestId("voice-hint")).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // Wait until the worker controls the page so the reload below is served through it.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.reload();
  await expect(page.getByTestId("voice-hint")).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("voice-hint")).toBeVisible();
  await context.setOffline(false);
});
