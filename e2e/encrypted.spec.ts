import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openPdf } from "../src/test/pdfjs";

const fixture = (name: string) => ({ name: `${name}.pdf`, mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/pdf/__fixtures__", `${name}.pdf`)) });

for (const name of ["encrypted-rc4-128", "encrypted-aes-256", "encrypted-aes-128-objstm"]) {
  test(`${name}: opens, renders text, and exports an unencrypted PDF`, async ({ page }) => {
    await page.goto("/");
    await page.setInputFiles('input[type="file"]', fixture(name));
    await page.waitForFunction(() => document.querySelectorAll(".page canvas[style*='height']").length >= 1);
    await expect(page.locator(".page .textLayer").first()).toContainText("encrypted:0", { timeout: 30_000 });
    await expect(page.locator(".pageview .page")).toHaveCount(2);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
    const bytes = new Uint8Array(readFileSync((await download.path())!));
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    expect(doc.isEncrypted).toBe(false);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getForm().getTextField("name").getText()).toBe("Alice");
    const pdf = await openPdf(bytes);
    const text = (await (await pdf.getPage(2)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("");
    expect(text).toContain("encrypted:1");
  });
}

test("a PDF with a real user password is reported as password-protected, not unreadable", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', fixture("encrypted-userpw-aes-128"));
  await expect(page.getByText(/password-protected/)).toBeVisible();
  await expect(page.getByText(/Couldn't read/)).toHaveCount(0);
});
