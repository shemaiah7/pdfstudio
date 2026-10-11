import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { sweepUnreachable } from "./sweep";

describe("sweepUnreachable", () => {
  it("deletes an orphaned stream and keeps a referenced one", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const orphan = doc.context.register(doc.context.flateStream(new Uint8Array([1, 2, 3])));
    const kept = doc.context.register(doc.context.flateStream(new Uint8Array([4, 5, 6])));
    page.node.set(PDFName.of("Custom"), kept);
    expect(sweepUnreachable(doc)).toBeGreaterThanOrEqual(1);
    expect(doc.context.lookup(orphan)).toBeUndefined();
    expect(doc.context.lookup(kept)).toBeDefined();
    const reloaded = await PDFDocument.load(await doc.save());
    expect(reloaded.getPageCount()).toBe(1);
  });
  it("keeps objects reachable only via AcroForm /DR fonts and widget /AP streams", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const fontRef = doc.context.register(doc.context.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" }));
    const field = doc.getForm().createTextField("f");
    field.setText("hello");
    field.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    doc.getForm().updateFieldAppearances();
    const acro = doc.getForm().acroForm.dict;
    const dr = doc.context.obj({ Font: { Helv: fontRef } });
    acro.set(PDFName.of("DR"), dr);
    const widget = field.acroField.getWidgets()[0];
    const ap = widget.dict.lookup(PDFName.of("AP"));
    expect(ap).toBeDefined();
    const orphan = doc.context.register(doc.context.flateStream(new Uint8Array([9])));
    sweepUnreachable(doc);
    expect(doc.context.lookup(orphan)).toBeUndefined();
    expect(doc.context.lookup(fontRef)).toBeDefined();
    const n = widget.dict.lookup(PDFName.of("AP")) as unknown as { lookup(k: PDFName): unknown };
    expect(n.lookup(PDFName.of("N"))).toBeDefined();
    const reloaded = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
    expect(reloaded.getForm().getTextField("f").getText()).toBe("hello");
  });
});
