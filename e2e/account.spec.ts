import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const fixture = { name: "three.pdf", mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures/three.pdf")) };

for (const [plan, editable] of [["free", false], ["trial", true]] as const) {
  test(`plan ${plan}: editing ${editable ? "allowed" : "locked"}`, async ({ page }) => {
    await page.addInitScript((p) => { try { localStorage.setItem("pdfstudio.account", JSON.stringify({ at: Date.now(), me: { plan: p, paywall: true, termsAccepted: true } })); } catch {} }, plan);
    await page.route("**/me", (r) => r.fulfill({ json: { plan, paywall: true, termsAccepted: true } }));
    await page.goto("/?paywall=1");
    await page.setInputFiles('input[type="file"]', fixture);
    await page.getByTestId("tool-ink").click();
    if (editable) await expect(page.getByTestId("tool-ink")).toHaveAttribute("aria-pressed", "true");
    else await expect(page.getByRole("dialog", { name: /Pro/ })).toBeVisible();
  });
}

test("back from Checkout on the empty state: Activating Pro, then Pro is active", async ({ page }) => {
  // No Clerk key in dev: the session comes from a stubbed Turnstile and a mocked /session.
  await page.route("https://challenges.cloudflare.com/**", (r) => r.abort());
  await page.addInitScript(() => {
    (window as unknown as { turnstile: unknown }).turnstile = { render: (_el: unknown, o: { callback(t: string): void }) => { setTimeout(() => o.callback("tt"), 0); return "w"; }, remove: () => {} };
  });
  await page.route("**/session", (r) => r.fulfill({ json: { token: "t", expiresAt: 9999999999, plan: "free" } }));
  let calls = 0;
  await page.route("**/me", (r) => r.fulfill({ json: { plan: ++calls >= 2 ? "pro" : "free", paywall: true, termsAccepted: true } }));
  await page.goto("/?paywall=1&checkout=success");
  await expect(page.getByText("Activating Pro")).toBeVisible();
  await expect(page.getByText("Pro is active")).toBeVisible({ timeout: 15_000 });
  expect(calls).toBeGreaterThanOrEqual(2);
  await expect(page).not.toHaveURL(/checkout=/);
});
