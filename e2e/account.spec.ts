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
