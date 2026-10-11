import { describe, it, expect } from "vitest";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { buildDocument, countPages, addRotation } from "./pageOps";
import type { SourceFile, PageEntry } from "./types";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadFixture } from "../test/loadFixture";
import { PNG_1X1 } from "../test/png";

function src(id: string, name: "three" | "two" | "rotated", pageCount: number): SourceFile {
  return { id, name: `${name}.pdf`, bytes: loadFixture(name), pageCount };
}

function entry(sourceId: string, i: number, rotation: 0 | 90 | 180 | 270 = 0): PageEntry {
  return { id: `${sourceId}-${i}`, sourceId, sourcePageIndex: i, rotation };
}

async function pageContent(doc: PDFDocument, i: number): Promise<string> {
  // Concatenated, decoded content streams of page i.
  const page = doc.getPages()[i];
  const contents = doc.context.lookup(page.node.Contents() as any);
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  let text = "";
  for (const ref of refs) {
    const stream = doc.context.lookup(ref as any);
    if (stream instanceof PDFRawStream) {
      text += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode()) + "\n";
    }
  }
  return text;
}

function decodeTjStrings(text: string): string[] {
  // Hex string operands of Tj, and of TJ arrays.
  const hexToStr = (h: string) => h.replace(/../g, (x) => String.fromCharCode(parseInt(x, 16)));
  const out: string[] = [];
  for (const m of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(hexToStr(m[1]));
  for (const m of text.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    out.push([...m[1].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hexToStr(x[1])).join(""));
  }
  return out;
}

async function markers(bytes: Uint8Array): Promise<string[]> {
  // pdf-lib writes page contents as an array of Flate-compressed streams whose text
  // is a hex string (`<74687265...> Tj`). Decode every stream and read the marker back.
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const text = await pageContent(doc, i);
    const m = text.match(/<([0-9A-Fa-f]+)>\s*Tj/);
    out.push(m ? m[1].replace(/../g, (h) => String.fromCharCode(parseInt(h, 16))) : "?");
  }
  return out;
}

describe("addRotation", () => {
  it("wraps within 0..270", () => {
    expect(addRotation(0, 90)).toBe(90);
    expect(addRotation(270, 90)).toBe(0);
    expect(addRotation(0, -90)).toBe(270);
    expect(addRotation(180, 180)).toBe(0);
  });
});

describe("countPages", () => {
  it("reads page count", async () => {
    expect(await countPages(loadFixture("three"))).toBe(3);
  });
});

describe("buildDocument", () => {
  const sources = new Map<string, SourceFile>([
    ["a", src("a", "three", 3)],
    ["b", src("b", "two", 2)],
  ]);

  it("merges two sources in list order", async () => {
    const pages = [entry("a", 0), entry("a", 1), entry("a", 2), entry("b", 0), entry("b", 1)];
    const out = await buildDocument(sources, pages);
    expect(await markers(out)).toEqual(["three:0", "three:1", "three:2", "two:0", "two:1"]);
  });

  it("reorders and deletes", async () => {
    const pages = [entry("b", 1), entry("a", 2), entry("a", 0)];
    const out = await buildDocument(sources, pages);
    expect(await markers(out)).toEqual(["two:1", "three:2", "three:0"]);
  });

  it("extracts a subset", async () => {
    const pages = [entry("a", 1)];
    const out = await buildDocument(sources, pages);
    expect(await countPages(out)).toBe(1);
    expect(await markers(out)).toEqual(["three:1"]);
  });

  it("applies rotation on top of source rotation", async () => {
    const s = new Map([["r", src("r", "rotated", 2)]]);
    const pages = [entry("r", 0, 90), entry("r", 1, 90)];
    const out = await buildDocument(s, pages);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(1).getRotation().angle).toBe(180); // 90 source + 90 user
  });

  it("can include the same source twice", async () => {
    const s = new Map([
      ["a1", src("a1", "three", 3)],
      ["a2", src("a2", "three", 3)],
    ]);
    const pages = [0, 1, 2].map((i) => entry("a1", i)).concat([0, 1, 2].map((i) => entry("a2", i)));
    const out = await buildDocument(s, pages);
    expect(await countPages(out)).toBe(6);
  });

  it("rejects an entry pointing past the source's page count", async () => {
    await expect(buildDocument(sources, [entry("a", 7)])).rejects.toThrow(/page 8/);
  });
});

describe("edits on export", () => {
  it("draws a white rectangle and the replacement text on the right page", async () => {
    const s = new Map([["a", src("a", "three", 3)]]);
    const pages = [entry("a", 0), entry("a", 1)];
    const out = await buildDocument(s, pages, [
      { id: "e1", pageEntryId: "a-1", boxes: [{ x: 20, y: 350, width: 120, height: 24 }], text: "Replaced", fontSize: 20, font: "helvetica", color: [0, 0, 0] },
    ]);
    const doc = await PDFDocument.load(out);
    const page0 = await pageContent(doc, 0);
    const page1 = await pageContent(doc, 1);
    expect(page0).not.toContain("1 1 1 rg");
    // pdf-lib emits the rectangle as a translated path (cm + m/l), not `re`.
    expect(page1).toMatch(/1 0 0 1 20 350 cm[\s\S]*?0 24 l\n120 24 l\n120 0 l/);
    expect(page1).toMatch(/1 1 1 rg/);
    expect(decodeTjStrings(page1)).toContain("Replaced");
  });
  it("replaces characters outside WinAnsi instead of throwing", async () => {
    const s = new Map([["a", src("a", "three", 3)]]);
    const out = await buildDocument(s, [entry("a", 0)], [
      { id: "e1", pageEntryId: "a-0", boxes: [{ x: 20, y: 350, width: 200, height: 24 }], text: "Hi \u4e2d", fontSize: 12, font: "helvetica", color: [0, 0, 0] },
    ]);
    const doc = await PDFDocument.load(out);
    expect(decodeTjStrings(await pageContent(doc, 0))).toContain("Hi ?");
  });
  it("draws WinAnsi punctuation as measured instead of replacing it", async () => {
    const s = new Map([["a", src("a", "three", 3)]]);
    const out = await buildDocument(s, [entry("a", 0)], [
      { id: "e1", pageEntryId: "a-0", boxes: [{ x: 20, y: 350, width: 200, height: 24 }], text: "a\u2014b", fontSize: 12, font: "helvetica", color: [0, 0, 0] },
    ]);
    // pdf-lib encodes an em dash as WinAnsi 0x97.
    expect(decodeTjStrings(await pageContent(await PDFDocument.load(out), 0))).toContain("a\u0097b");
  });
  it("offsets edits by the crop box origin", async () => {
    const s = new Map([["o", { id: "o", name: "offset.pdf", bytes: loadFixture("offset"), pageCount: 1 }]]);
    const out = await buildDocument(s, [entry("o", 0)], [
      { id: "e1", pageEntryId: "o-0", boxes: [{ x: 20, y: 350, width: 120, height: 24 }], text: "Hi", fontSize: 12, font: "helvetica", color: [0, 0, 0] },
    ]);
    const content = await pageContent(await PDFDocument.load(out), 0);
    expect(content).toMatch(/1 0 0 1 70 450 cm/);
    expect(content).toMatch(/1 0 0 1 70 \d+(\.\d+)? Tm/);
  });
  it("lays text out per selected line box", async () => {
    const s = new Map([["a", src("a", "three", 3)]]);
    const out = await buildDocument(s, [entry("a", 0)], [
      { id: "e1", pageEntryId: "a-0", boxes: [{ x: 120, y: 400, width: 80, height: 14 }, { x: 20, y: 380, width: 180, height: 14 }], text: "aaa bbb ccc ddd eee fff", fontSize: 12, font: "helvetica", color: [0, 0, 0] },
    ]);
    const content = await pageContent(await PDFDocument.load(out), 0);
    const xs = [...content.matchAll(/1 0 0 1 (\d+(?:\.\d+)?) \d+(?:\.\d+)? Tm/g)].map((m) => Number(m[1]));
    expect(xs.slice(-2)).toEqual([120, 20]); // the page's own text precedes the edit
  });
});

it("draws an edit with a courier-bold face, a coloured cover, and the crop origin offset", async () => {
  const bytes = loadFixture("offset");            // crop box origin (50,100)
  const sources = new Map([["s", { id: "s", name: "offset.pdf", bytes, pageCount: 1 }]]);
  const pages = [{ id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 as const }];
  const out = await buildDocument(sources, pages, [{ id: "e", pageEntryId: "p", boxes: [{ x: 20, y: 300, width: 120, height: 14 }], text: "Dose 10 mg", fontSize: 11, font: "courier-bold", color: [0, 0, 1], background: [1, 1, 0.8], lineHeight: 13, source: "native" }]);
  const pdf = await getDocument({ data: out.slice() }).promise;
  const page = await pdf.getPage(1);
  const items = (await page.getTextContent()).items.filter((i): i is typeof i & { str: string; transform: number[] } => "str" in i);
  const hit = items.find((i) => i.str.includes("Dose"));
  expect(hit).toBeDefined();
  expect(hit!.transform[4]).toBeCloseTo(20 + 50, 0);
  // Fonts live in compressed object streams and content streams are Flate-compressed, so inspect the parsed document.
  const reloaded = await PDFDocument.load(out);
  const baseFonts = [...reloaded.context.enumerateIndirectObjects()].map(([, o]) => String((o as { get?: (k: PDFName) => unknown }).get?.(PDFName.of("BaseFont")) ?? ""));
  expect(baseFonts).toContain("/Courier-Bold");
  expect(await pageContent(reloaded, 0)).toMatch(/1 1 0\.8 rg/);
});
it("still accepts legacy font names from the AI insert", async () => {
  const bytes = loadFixture("three");
  const sources = new Map([["s", { id: "s", name: "three.pdf", bytes, pageCount: 1 }]]);
  const pages = [{ id: "p", sourceId: "s", sourcePageIndex: 0, rotation: 0 as const }];
  await expect(buildDocument(sources, pages, [{ id: "e", pageEntryId: "p", boxes: [{ x: 20, y: 300, width: 120, height: 14 }], text: "x", fontSize: 11, font: "sans-bold" as never, color: [0, 0, 0] }])).resolves.toBeInstanceOf(Uint8Array);
});

describe("flatten edited native pages", () => {
  const edit = { id: "e1", pageEntryId: "a-0", boxes: [{ x: 20, y: 350, width: 200, height: 24 }], text: "thre:9", fontSize: 12, font: "helvetica" as const, color: [0, 0, 0] as [number, number, number] };
  const texts = async (bytes: Uint8Array) => {
    const pdf = await getDocument({ data: bytes.slice() }).promise;
    return (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
  };
  const s = () => new Map([["a", src("a", "three", 3)]]);
  const items = [
    { str: "thre:9", x: 20, y: 352, width: 40, height: 12, fontSize: 12, fontName: "helvetica" },
    { str: "other", x: 20, y: 200, width: 30, height: 12, fontSize: 12, fontName: "g_d0_f1" },
  ];
  it("removes the original text from the output when a rasterizer is supplied", async () => {
    const out = await buildDocument(s(), [entry("a", 0)], [edit], [], new Map(), undefined, undefined, {
      rasterize: async () => ({ png: PNG_1X1, widthPt: 612, heightPt: 792 }),
      editedText: async () => items,
    });
    const text = await texts(out);
    expect(text).not.toContain("three:0");
    expect(text.match(/thre:9/g)).toHaveLength(1); // visible edit only; edit-font items are not duplicated invisibly
    expect(text).toContain("other");
  });
  // Content-stream text is hex-encoded (`<74...> Tj`), so look for the literal and for its hex form in every decoded stream.
  const allStreams = async (bytes: Uint8Array) => {
    const doc = await PDFDocument.load(bytes);
    let all = "";
    for (const [, o] of doc.context.enumerateIndirectObjects()) if (o instanceof PDFRawStream) all += new TextDecoder("latin1").decode(decodePDFRawStream(o).decode()) + "\n";
    return all;
  };
  const mentions = (hay: string, text: string) => hay.includes(text) || hay.toUpperCase().includes([...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase());
  const flat = { rasterize: async () => ({ png: PNG_1X1, widthPt: 612, heightPt: 792 }), editedText: async () => items };
  it("leaves the original string in no stream of the flattened file (positive control: it is in the unflattened one)", async () => {
    expect(mentions(await allStreams(await buildDocument(s(), [entry("a", 0)], [edit])), "three:0")).toBe(true);
    const out = await buildDocument(s(), [entry("a", 0)], [edit], [], new Map(), undefined, undefined, flat);
    expect(mentions(await allStreams(out), "three:0")).toBe(false);
    expect(mentions(await allStreams(out), "thre:9")).toBe(true); // the edit itself is there
  });
  it("hands the page's cover boxes and colours to the rasterizer", async () => {
    let seen: unknown;
    await buildDocument(s(), [entry("a", 0)], [{ ...edit, background: [0.5, 0.5, 0.5] }], [], new Map(), undefined, undefined, { ...flat, rasterize: async (_s, _p, _d, covers) => { seen = covers; return { png: PNG_1X1, widthPt: 612, heightPt: 792 }; } });
    expect(seen).toEqual([{ box: edit.boxes[0], color: [0.5, 0.5, 0.5] }]);
  });
  it("flattens edited OCR pages like native ones: edited items form the invisible layer, no second layer", async () => {
    const ocr = { engine: "tesseract" as const, confidence: 1, at: 1, lines: [{ text: "three:0", box: { x: 20, y: 352, width: 40, height: 12 }, words: [{ text: "three:0", confidence: 1, box: { x: 20, y: 352, width: 40, height: 12 } }] }] };
    const out = await buildDocument(s(), [entry("a", 0)], [{ ...edit, source: "ocr" }], [], new Map(), undefined, new Map([["a-0", ocr]]), flat);
    const text = await texts(out);
    expect(text).not.toContain("three:0");
    expect(text.match(/thre:9/g)).toHaveLength(1);
    expect(text).toContain("other");
    expect(mentions(await allStreams(out), "three:0")).toBe(false);
  });
  it("keeps Deep OCR pages without an invisible layer and warns once", async () => {
    const warnings: string[] = [];
    const ocr = { engine: "claude" as const, confidence: 1, at: 1, lines: [{ text: "three:0", box: { x: 20, y: 352, width: 40, height: 12 }, words: [{ text: "three:0", confidence: 1, box: { x: 20, y: 352, width: 40, height: 12 } }] }] };
    const out = await buildDocument(s(), [entry("a", 0)], [{ ...edit, source: "ocr" }], [], new Map(), (m) => warnings.push(m), new Map([["a-0", ocr]]), flat);
    expect(warnings).toEqual(["Searchable text left out of edited Deep OCR pages."]);
    expect(await texts(out)).not.toContain("three:0");
    expect(await texts(out)).not.toContain("other");
  });
  it("restores the original page and warns once when flattening fails after the content was cleared", async () => {
    const warnings: string[] = [];
    // Only the invisible-text layer reads `x`, which happens after /Contents was swapped out.
    const bad = [{ ...items[1], get x(): number { throw new Error("late failure"); } }];
    const two = [{ ...edit }, { ...edit, id: "e2", pageEntryId: "a-1" }];
    const out = await buildDocument(s(), [entry("a", 0), entry("a", 1)], two, [], new Map(), (m) => warnings.push(m), undefined, { ...flat, editedText: async () => bad });
    expect(warnings).toEqual(["Saved without flattening; covered text may remain in the file."]);
    expect(await texts(out)).toContain("three:0");
    expect(await texts(out)).toContain("thre:9"); // the unflattened fallback still draws the edit
  });
  it("keeps the original text under the cover without a rasterizer", async () => {
    expect(await texts(await buildDocument(s(), [entry("a", 0)], [edit]))).toContain("three:0");
  });
  it("falls back to the unflattened page and warns once when rasterizing fails", async () => {
    const warnings: string[] = [];
    const two = [{ ...edit }, { ...edit, id: "e2", pageEntryId: "a-1" }];
    const out = await buildDocument(s(), [entry("a", 0), entry("a", 1)], two, [], new Map(), (m) => warnings.push(m), undefined, {
      rasterize: async () => { throw new Error("boom"); },
      editedText: async () => items,
    });
    expect(warnings).toEqual(["Saved without flattening; covered text may remain in the file."]);
    expect(await texts(out)).toContain("three:0");
  });
});
