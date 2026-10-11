import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

test.skip(!process.env.E2E_SEARCH, "set E2E_SEARCH=1 to run the model download test");

// The bundled fixtures hold one word per page (below the 3-word chunk minimum), so build a two-page
// PDF with real paragraphs: page 1 cardiology, page 2 dermatology.
async function clinicPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [
    "Cardiology note. The patient reported substernal chest pressure radiating to the left arm with diaphoresis. Troponin was elevated and an ECG showed ST depression in the lateral leads. Aspirin and nitroglycerin were given and cardiology was consulted for possible acute coronary syndrome.",
    "Dermatology note. A pruritic erythematous rash on the forearm appeared after gardening. No vesicles or systemic symptoms. Topical corticosteroid cream was prescribed and the patient was advised to avoid the suspected contact allergen and return if the rash spreads.",
  ];
  for (const text of pages) {
    const p = doc.addPage([400, 500]);
    let line = "", y = 460;
    for (const w of text.split(" ")) {
      if ((line + " " + w).length > 55) { p.drawText(line, { x: 30, y, size: 11, font }); y -= 16; line = w; }
      else line = line ? line + " " + w : w;
    }
    p.drawText(line, { x: 30, y, size: 11, font });
  }
  return Buffer.from(await doc.save());
}

test("enable search, index a file, find the right page", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', { name: "clinic.pdf", mimeType: "application/pdf", buffer: await clinicPdf() });
  await page.getByTestId("panel-tab-search").click();
  await page.getByTestId("search-enable").click();
  await expect(page.getByTestId("search-input")).toBeVisible({ timeout: 540_000 });
  await expect(page.locator(".search-status li").first()).toContainText(/indexed/, { timeout: 60_000 });
  await page.getByTestId("search-input").fill("heart attack symptoms");
  await expect(page.getByTestId("search-hit").first()).toContainText("p. 1", { timeout: 30_000 });
  await expect(page.getByTestId("search-hit").first()).toContainText(/Cardiology/);
});
