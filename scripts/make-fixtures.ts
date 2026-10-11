import { PDFDocument, StandardFonts, degrees, PDFHexString, PDFName, PDFDict, PDFArray } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "src/test/fixtures");
mkdirSync(outDir, { recursive: true });

async function make(name: string, pageCount: number, rotateIndex?: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 400]);
    page.drawText(`${name}:${i}`, { x: 20, y: 360, size: 24, font });
    if (rotateIndex === i) page.setRotation(degrees(90));
  }
  writeFileSync(join(outDir, `${name}.pdf`), await doc.save());
}

async function makeOffset() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 400]);
  page.setMediaBox(50, 100, 300, 400);
  page.setCropBox(50, 100, 300, 400);
  page.drawText("offset:0", { x: 70, y: 460, size: 24, font });
  writeFileSync(join(outDir, "offset.pdf"), await doc.save());
}

await make("three", 3);
await make("two", 2);
await make("rotated", 2, 1);
await makeOffset();
async function makeForm() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([300, 400]); const p2 = doc.addPage([300, 400]);
  p1.drawText("form:0", { x: 20, y: 360, size: 24, font }); p2.drawText("form:1", { x: 20, y: 360, size: 24, font });
  const form = doc.getForm();
  const name = form.createTextField("name"); name.addToPage(p1, { x: 20, y: 300, width: 200, height: 24, borderWidth: 0 });
  const agree = form.createCheckBox("agree"); agree.addToPage(p1, { x: 20, y: 250, width: 20, height: 20 });
  const size = form.createRadioGroup("size"); size.addOptionToPage("S", p1, { x: 20, y: 200, width: 18, height: 18 }); size.addOptionToPage("L", p1, { x: 60, y: 200, width: 18, height: 18 });
  const color = form.createDropdown("color"); color.addOptions(["red", "blue"]); color.addToPage(p1, { x: 20, y: 150, width: 120, height: 24 });
  const notes = form.createTextField("notes"); notes.addToPage(p1, { x: 20, y: 100, width: 200, height: 24 }); notes.addToPage(p2, { x: 20, y: 300, width: 200, height: 24 });
  // unsupported: a signature field dict
  const sigRef = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Widget", FT: "Sig", T: PDFHexString.fromText("sig"), Rect: [20, 40, 200, 80], F: 4, P: p2.ref }));
  p2.node.addAnnot(sigRef);
  (doc.context.lookup(doc.catalog.get(PDFName.of("AcroForm"))!) as PDFDict).lookup(PDFName.of("Fields"), PDFArray).push(sigRef);
  writeFileSync(join(outDir, "form.pdf"), await doc.save());
}
await makeForm();
console.log("fixtures written to", outDir);
