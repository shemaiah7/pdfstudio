import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from "pdf-lib";

/** Three pages, but the page tree's /Kids also points at a non-page object and /Count says 4. */
export async function damagedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) doc.addPage([200, 200]).drawText(`page ${i + 1}`);
  const root = doc.context.lookup(doc.catalog.get(PDFName.of("Pages")) as PDFRef, PDFDict);
  root.lookup(PDFName.of("Kids"), PDFArray).push(doc.context.register(PDFNumber.of(42)));
  root.set(PDFName.of("Count"), PDFNumber.of(4));
  return doc.save();
}
