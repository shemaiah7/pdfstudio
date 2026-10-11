import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFields, fieldsOnPage } from "./forms";
import { buildDocument } from "./pageOps";
import type { SourceFile } from "./types";
import { loadFixture } from "../test/loadFixture";

const src = (): SourceFile => ({ id: "f", name: "form.pdf", bytes: loadFixture("form"), pageCount: 2 });
const pages = [{ id: "p0", sourceId: "f", sourcePageIndex: 0, rotation: 0 as const }, { id: "p1", sourceId: "f", sourcePageIndex: 1, rotation: 0 as const }];
const values = (m: Record<string, string | boolean | string[]>) => new Map([["f", new Map(Object.entries(m))]]);

describe("readFields", () => {
  it("reads names, types, options, widgets per page", async () => {
    const fields = await readFields(src());
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.name).toMatchObject({ type: "text", widgets: [{ pageIndex: 0, rect: { x: 20, y: 300, width: 200, height: 24 } }] });
    expect(byName.agree.type).toBe("checkbox");
    expect(byName.size).toMatchObject({ type: "radio", options: ["S", "L"] });
    expect(byName.color).toMatchObject({ type: "dropdown", options: ["red", "blue"] });
    expect(byName.notes.widgets.map((w) => w.pageIndex)).toEqual([0, 1]);
    expect(byName.sig.type).toBe("unsupported");
    expect(fieldsOnPage(fields, 1).map((f) => f.name).sort()).toEqual(["notes", "sig"]);
  });
});

describe("form export", () => {
  it("round-trips values through a copied page, including radio export values and checkbox on-value", async () => {
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [], values({ name: "Alice", agree: true, size: "L", color: "blue", notes: "n" }));
    const doc = await PDFDocument.load(out);
    const form = doc.getForm();
    expect(form.getTextField("name").getText()).toBe("Alice");
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
    expect(form.getRadioGroup("size").getSelected()).toBe("L");
    expect(form.getDropdown("color").getSelected()).toEqual(["blue"]);
    const pdf = await getDocument({ data: out.slice() }).promise;
    const anns = await (await pdf.getPage(1)).getAnnotations({ intent: "display" });
    expect(anns.find((a: any) => a.fieldName === "name")).toMatchObject({ fieldValue: "Alice", hasAppearance: true });
  });

  it("extracting only page 2 keeps just the fields with widgets there", async () => {
    const out = await buildDocument(new Map([["f", src()]]), [pages[1]], [], [], values({ notes: "only", name: "ignored" }));
    const doc = await PDFDocument.load(out);
    const names = doc.getForm().getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(["notes", "sig"]);
    expect(doc.getForm().getTextField("notes").getText()).toBe("only");
    expect(doc.getForm().getTextField("notes").acroField.getWidgets().length).toBe(1);
  });

  it("export without values leaves fields intact and unsupported fields untouched", async () => {
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [], new Map());
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getFields().length).toBe(6);
  });

  it("keeps DR/Font/Helv and fields when a freetext annotation and filled form coexist", async () => {
    const ann = { id: "a", pageEntryId: "p0", kind: "freetext" as const, color: [0, 0, 0] as [number, number, number], box: { x: 50, y: 50, width: 100, height: 30 }, text: "hello", fontSize: 12 };
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [ann], values({ name: "Bob" }));
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getTextField("name").getText()).toBe("Bob");
    expect(doc.getForm().getFields().length).toBe(6);
    const acro = doc.context.lookup(doc.catalog.get(PDFName.of("AcroForm"))!) as PDFDict;
    const dr = acro.lookup(PDFName.of("DR"), PDFDict);
    expect(dr.lookup(PDFName.of("Font"), PDFDict).has(PDFName.of("Helv"))).toBe(true);
  });
});
