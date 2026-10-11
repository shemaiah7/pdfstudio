import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
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
console.log("fixtures written to", outDir);
