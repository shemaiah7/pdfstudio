import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string) => ({ name: `${name}.pdf`, mimeType: "application/pdf", buffer: readFileSync(join(process.cwd(), "src/test/fixtures", `${name}.pdf`)) });

test("drag a box over the left column, change one value, keep the bold label and the right column", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.setInputFiles('input[type="file"]', fixture("columns"));
  await expect(page.locator(".page .textLayer span").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("tool-edit").click();
  const label = page.locator(".page").first().locator(".textLayer span", { hasText: "Assigned Caregiver" });
  const value = page.locator(".page").first().locator(".textLayer span", { hasText: "Rylee Lyons" }).first();
  const lb = (await label.boundingBox())!, vb = (await value.boundingBox())!;
  // Drag from above-left of the label to below-right of the value: covers the two left columns of row 1 only.
  await page.mouse.move(lb.x - 6, lb.y - 4);
  await page.mouse.down();
  await page.mouse.move(vb.x + vb.width + 6, vb.y + vb.height + 4, { steps: 5 });
  await expect(page.getByTestId("drag-box")).toBeVisible();
  await page.mouse.up();
  // The label and the value sit more than 1.2 em apart, so each is its own line and its own field.
  const fields = page.getByTestId("line-field");
  await expect(fields).toHaveCount(2);
  await expect(fields.nth(0)).toHaveText("Assigned Caregiver");
  await expect(fields.nth(1)).toHaveText("Rylee Lyons");
  const setRun = (i: number, text: string) => fields.nth(i).locator("[data-run]").first().evaluate((el, t) => { el.textContent = t; el.dispatchEvent(new Event("input", { bubbles: true })); }, text);
  // Change both so the bold label is redrawn too (unchanged lines stay in the page and are not redrawn).
  const labelRun = (await fields.nth(0).locator("[data-run]").first().boundingBox())!;
  await page.mouse.dblclick(labelRun.x + labelRun.width - 4, labelRun.y + labelRun.height / 2); // selects "Caregiver"
  await page.keyboard.type("Nurse");
  await expect(fields.nth(0)).toHaveText("Assigned Nurse");
  await setRun(1, "Jamie Lee");
  await page.getByTestId("line-done").click();
  const lines = page.locator(".edit-line");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toHaveText("Assigned Nurse");
  await expect(lines.nth(0)).toHaveCSS("font-weight", "700");
  await expect(lines.nth(1)).toHaveText("Jamie Lee");
  // Right column untouched.
  await expect(page.locator(".page").first().locator(".textLayer span", { hasText: "Respiration" })).toBeVisible();
  // Export: bold face embedded, new value present, old value gone from every stream.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const bytes = new Uint8Array(readFileSync((await download.path()) as string));
  const { openPdf } = await import("../src/test/pdfjs");
  const pdf = await openPdf(bytes);
  const tc = await (await pdf.getPage(1)).getTextContent();
  const text = tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  expect(text).toContain("Jamie Lee");
  expect(text).toContain("Respiration");
  expect(text).not.toContain("Assigned Caregiver");
  const { PDFDocument, PDFRawStream, decodePDFRawStream, PDFName, PDFDict } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes);
  const baseFonts: string[] = [];
  for (const [, o] of doc.context.enumerateIndirectObjects()) if (o instanceof PDFDict) { const bf = o.get(PDFName.of("BaseFont")); if (bf) baseFonts.push(String(bf)); }
  expect(baseFonts.join(" ")).toMatch(/Helvetica-Bold/);
  let all = "";
  for (const [, o] of doc.context.enumerateIndirectObjects()) if (o instanceof PDFRawStream) all += new TextDecoder("latin1").decode(decodePDFRawStream(o).decode()) + "\n";
  const hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();
  expect(all.includes("Jamie Lee") || all.toUpperCase().includes(hex("Jamie Lee"))).toBe(true);
});

test("click a mixed-run line, retype the regular word, keep the bold label", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.setInputFiles('input[type="file"]', fixture("columns"));
  await expect(page.locator(".page .textLayer span").first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("tool-edit").click();
  const open = page.locator(".page").first().locator(".textLayer span", { hasText: "Open" }).first();
  const ob = (await open.boundingBox())!;
  await page.mouse.click(ob.x + ob.width - 3, ob.y + ob.height / 2);
  const fields = page.getByTestId("line-field");
  await expect(fields).toHaveCount(1);
  const runs = fields.locator("[data-run]");
  await expect(runs).toHaveCount(2);
  await expect(runs.nth(0)).toHaveText("Status: ");
  await expect(runs.nth(1)).toHaveText("Open");
  await runs.nth(1).dblclick();
  await page.keyboard.type("Closed");
  await page.keyboard.press("Enter");
  const lines = page.locator(".edit-line");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toHaveText("Status: ");
  await expect(lines.nth(0)).toHaveCSS("font-weight", "700");
  await expect(lines.nth(1)).toHaveText("Closed");
  await expect(lines.nth(1)).toHaveCSS("font-weight", "400");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const bytes = new Uint8Array(readFileSync((await download.path()) as string));
  const { openPdf } = await import("../src/test/pdfjs");
  const pdf = await openPdf(bytes);
  const tc = await (await pdf.getPage(1)).getTextContent();
  const text = tc.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  expect(text.replace(/\s+/g, " ")).toContain("Status: Closed");
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes);
  let all = "";
  for (const [, o] of doc.context.enumerateIndirectObjects()) if (o instanceof PDFRawStream) all += new TextDecoder("latin1").decode(decodePDFRawStream(o).decode()) + "\n";
  const hex = (t: string) => [...t].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();
  expect(all.includes("Closed") || all.toUpperCase().includes(hex("Closed"))).toBe(true);
});
