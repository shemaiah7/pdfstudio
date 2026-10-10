import { test, expect } from "@playwright/test";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { readFileSync } from "node:fs";

test("drag first page to end and download in new order", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles('input[type="file"]', "src/test/fixtures/three.pdf");
  const thumbs = page.getByTestId("thumb");
  await expect(thumbs).toHaveCount(3);

  // Thumbnails change height once pdf.js has rendered them; wait so the boxes measured below are final.
  await page.waitForFunction(() => {
    const c = [...document.querySelectorAll<HTMLCanvasElement>('[data-testid="thumb"] canvas')];
    return c.length === 3 && c.every((x) => x.style.height !== "");
  });

  const first = thumbs.nth(0);
  const last = thumbs.nth(2);
  const a = await first.boundingBox();
  const b = await last.boundingBox();
  if (!a || !b) throw new Error("no thumbs");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 4, { steps: 10 });
  await page.mouse.up();
  // dnd-kit swallows the first click for a moment after a drag ends; wait it out.
  await expect(page.locator(".count")).toContainText("unsaved");
  await page.waitForTimeout(200);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download").click(),
  ]);
  expect(download.suggestedFilename()).toBe("three-edited.pdf");
  const path = await download.path();
  const doc = await PDFDocument.load(readFileSync(path!));
  expect(doc.getPageCount()).toBe(3);
  // Page content is Flate-compressed with a hex-encoded string; decode each page's streams in page order.
  const found = doc.getPages().map((pg) => {
    const contents = doc.context.lookup(pg.node.Contents() as any);
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    let text = "";
    for (const ref of refs) {
      const stream = doc.context.lookup(ref as any);
      if (stream instanceof PDFRawStream) text += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
    }
    const m = text.match(/<([0-9A-Fa-f]+)>\s*Tj/);
    return m ? m[1].replace(/../g, (h) => String.fromCharCode(parseInt(h, 16))) : "?";
  });
  // Marker order in the output should be 1, 2, 0.
  expect(found).toEqual(["three:1", "three:2", "three:0"]);
});
