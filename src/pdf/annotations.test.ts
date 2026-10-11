import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildDocument } from "./pageOps";
import { isDegenerate } from "./annotations";
import type { Annotation, SourceFile } from "./types";
import { loadFixture } from "../test/loadFixture";

const sources = new Map<string, SourceFile>([["a", { id: "a", name: "three.pdf", bytes: loadFixture("three"), pageCount: 3 }]]);
const page = { id: "p1", sourceId: "a", sourcePageIndex: 0, rotation: 0 as const };
const base = { pageEntryId: "p1", color: [1, 0, 0] as [number, number, number] };

async function annotsOf(bytes: Uint8Array, pageIdx = 0) {
  const doc = await PDFDocument.load(bytes);
  const arr = doc.getPage(pageIdx).node.Annots()!;
  return arr.asArray().map((r) => doc.context.lookup(r) as PDFDict).map((d) => ({ d, doc }));
}
const name = (d: PDFDict, k: string) => String(d.get(PDFName.of(k)));
async function pdfjsAnnots(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice() }).promise;
  return (await pdf.getPage(1)).getAnnotations({ intent: "display" });
}

describe("writeAnnotations", () => {
  it("highlight has QuadPoints, colour, and an appearance stream with multiply blend", async () => {
    const a: Annotation = { id: "h", kind: "highlight", ...base, color: [1, 0.84, 0], boxes: [{ x: 20, y: 350, width: 100, height: 24 }] };
    const out = await buildDocument(sources, [page], [], [a]);
    const [{ d, doc }] = await annotsOf(out);
    expect(name(d, "Subtype")).toBe("/Highlight");
    const qp = (d.get(PDFName.of("QuadPoints")) as PDFArray).asArray().map(Number);
    expect(qp).toEqual([20, 374, 120, 374, 20, 350, 120, 350]);
    const ap = doc.context.lookup((d.get(PDFName.of("AP")) as PDFDict).get(PDFName.of("N"))) as PDFStream;
    expect(ap).toBeTruthy();
    const js = await pdfjsAnnots(out);
    expect(js[0]).toMatchObject({ subtype: "Highlight", hasAppearance: true });
  });

  it("note has popup with escaped and non-Latin contents", async () => {
    const text = "Check (this) \\ value — 日本語";
    const a: Annotation = { id: "n", kind: "note", ...base, x: 30, y: 300, text };
    const out = await buildDocument(sources, [page], [], [a]);
    const anns = await annotsOf(out);
    expect(anns.map((x) => name(x.d, "Subtype")).sort()).toEqual(["/Popup", "/Text"]);
    const js = await pdfjsAnnots(out);
    const t = js.find((x: any) => x.subtype === "Text");
    expect(t.contentsObj.str).toBe(text);
    expect(t.popupRef).toBeTruthy(); // this pdf.js version exposes popupRef, not hasPopup
  });

  it("ink has InkList and width", async () => {
    const a: Annotation = { id: "i", kind: "ink", ...base, width: 2.5, strokes: [[{ x: 10, y: 10 }, { x: 50, y: 60 }, { x: 90, y: 10 }]] };
    const out = await buildDocument(sources, [page], [], [a]);
    const [{ d }] = await annotsOf(out);
    expect(name(d, "Subtype")).toBe("/Ink");
    const ink = (d.get(PDFName.of("InkList")) as PDFArray).asArray()[0] as PDFArray;
    expect(ink.asArray().map(Number)).toEqual([10, 10, 50, 60, 90, 10]);
  });

  it("rect and arrow become Square and Line with OpenArrow", async () => {
    const r: Annotation = { id: "r", kind: "shape", ...base, shape: "rect", x1: 10, y1: 10, x2: 110, y2: 60, width: 1 };
    const l: Annotation = { id: "l", kind: "shape", ...base, shape: "arrow", x1: 10, y1: 100, x2: 110, y2: 160, width: 2.5 };
    const out = await buildDocument(sources, [page], [], [r, l]);
    const anns = await annotsOf(out);
    expect(anns.map((x) => name(x.d, "Subtype"))).toEqual(["/Square", "/Line"]);
    const le = (anns[1].d.get(PDFName.of("LE")) as PDFArray).asArray().map((n) => String(n));
    expect(le).toEqual(["/None", "/OpenArrow"]);
  });

  it("free text has DA and Contents and pdf.js renders it", async () => {
    const a: Annotation = { id: "f", kind: "freetext", ...base, box: { x: 20, y: 200, width: 150, height: 40 }, text: "Hello box", fontSize: 12 };
    const out = await buildDocument(sources, [page], [], [a]);
    const js = await pdfjsAnnots(out);
    expect(js[0]).toMatchObject({ subtype: "FreeText", hasAppearance: true });
    expect(js[0].contentsObj.str).toBe("Hello box");
  });

  it("signature is flattened as an image and creates no annotation", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const a: Annotation = { id: "s", kind: "signature", ...base, box: { x: 20, y: 50, width: 90, height: 30 }, png };
    const out = await buildDocument(sources, [page], [], [a]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).node.Annots()?.asArray().length ?? 0).toBe(0);
    const xobjs = doc.getPage(0).node.Resources()?.lookup(PDFName.of("XObject")) as PDFDict | undefined;
    expect(xobjs && xobjs.keys().length).toBeGreaterThan(0);
  });

  it("skips degenerate annotations", async () => {
    expect(isDegenerate({ id: "x", kind: "ink", ...base, width: 1, strokes: [[{ x: 1, y: 1 }]] })).toBe(true);
    expect(isDegenerate({ id: "y", kind: "shape", ...base, shape: "rect", x1: 5, y1: 5, x2: 5, y2: 5, width: 1 })).toBe(true);
    const out = await buildDocument(sources, [page], [], [{ id: "x", kind: "ink", ...base, width: 1, strokes: [[{ x: 1, y: 1 }]] }]);
    expect((await PDFDocument.load(out)).getPage(0).node.Annots()?.asArray().length ?? 0).toBe(0);
  });

  it("applies the crop box offset", async () => {
    const off = new Map<string, SourceFile>([["o", { id: "o", name: "offset.pdf", bytes: loadFixture("offset"), pageCount: 1 }]]);
    const a: Annotation = { id: "r", kind: "shape", pageEntryId: "p", color: [0, 0, 0], shape: "rect", x1: 10, y1: 10, x2: 60, y2: 40, width: 1 };
    const out = await buildDocument(off, [{ id: "p", sourceId: "o", sourcePageIndex: 0, rotation: 0 }], [], [a]);
    const [{ d }] = await annotsOf(out);
    expect((d.get(PDFName.of("Rect")) as PDFArray).asArray().map(Number)).toEqual([60, 110, 110, 140]);
  });

  it("free text appearance encodes WinAnsi characters above U+00FF", async () => {
    const a: Annotation = { id: "f", kind: "freetext", ...base, box: { x: 20, y: 200, width: 150, height: 40 }, text: "It\u2019s \u2014 \u20AC5", fontSize: 12 };
    const out = await buildDocument(sources, [page], [], [a]);
    const [{ d, doc }] = await annotsOf(out);
    const ap = doc.context.lookup((d.get(PDFName.of("AP")) as PDFDict).get(PDFName.of("N"))) as PDFRawStream;
    const text = new TextDecoder("latin1").decode(decodePDFRawStream(ap).decode());
    expect(text).toContain("<497492732097208035> Tj");
  });

  it("highlight drops empty boxes", async () => {
    const a: Annotation = { id: "h", kind: "highlight", ...base, boxes: [{ x: 20, y: 350, width: 100, height: 24 }, { x: 20, y: 300, width: 100, height: 0 }] };
    const out = await buildDocument(sources, [page], [], [a]);
    const [{ d }] = await annotsOf(out);
    expect((d.get(PDFName.of("QuadPoints")) as PDFArray).asArray().length).toBe(8);
  });

  it("clamps colour components", async () => {
    const a: Annotation = { id: "r", kind: "shape", ...base, color: [2, NaN, -1], shape: "rect", x1: 10, y1: 10, x2: 110, y2: 60, width: 1 };
    const out = await buildDocument(sources, [page], [], [a]);
    const [{ d }] = await annotsOf(out);
    expect((d.get(PDFName.of("C")) as PDFArray).asArray().map(Number)).toEqual([1, 0, 0]);
  });
});

describe("rotated pages", () => {
  const rot = { ...page, rotation: 90 as const };
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const stream = (doc: PDFDocument, ref: any) => new TextDecoder("latin1").decode(decodePDFRawStream(doc.context.lookup(ref) as PDFRawStream).decode());

  it("free text gets a non-identity /Matrix on a rotated page and none when unrotated", async () => {
    const a: Annotation = { id: "f", kind: "freetext", ...base, box: { x: 20, y: 200, width: 40, height: 150 }, text: "Hello", fontSize: 12 };
    const [{ d, doc }] = await annotsOf(await buildDocument(sources, [rot], [], [a]));
    const ap = doc.context.lookup((d.get(PDFName.of("AP")) as PDFDict).get(PDFName.of("N"))) as PDFRawStream;
    const m = (ap.dict.get(PDFName.of("Matrix")) as PDFArray).asArray().map((n) => Math.round(Number(n)));
    expect(m).toEqual([0, 1, -1, 0, 0, 0]);
    expect((d.get(PDFName.of("Rect")) as PDFArray).asArray().map(Number)).toEqual([20, 200, 60, 350]);
    const [{ d: d0 }] = await annotsOf(await buildDocument(sources, [page], [], [{ ...a, box: { x: 20, y: 200, width: 150, height: 40 } }]));
    const ap0 = d0.context.lookup((d0.get(PDFName.of("AP")) as PDFDict).get(PDFName.of("N"))) as PDFRawStream;
    expect(ap0.dict.has(PDFName.of("Matrix"))).toBe(false);
  });

  it("signature is drawn with a rotation matrix on a rotated page", async () => {
    const a: Annotation = { id: "s", kind: "signature", ...base, box: { x: 20, y: 50, width: 30, height: 90 }, png };
    const doc = await PDFDocument.load(await buildDocument(sources, [rot], [], [a]));
    const contents = doc.getPage(0).node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [doc.getPage(0).node.get(PDFName.of("Contents"))];
    const text = refs.map((r) => stream(doc, r)).join("\n");
    const cm = [...text.matchAll(/([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) cm/g)].map((m) => m.slice(1, 7).map(Number));
    // pdf-lib emits a pure 90deg rotation matrix [0 1 -1 0 0 0]
    expect(cm.some(([a0, b, c, d0]) => Math.abs(a0) < 1e-6 && Math.abs(d0) < 1e-6 && Math.abs(b) > 0.5 && Math.abs(c) > 0.5)).toBe(true);
  });

  it("keeps a signature's aspect ratio when its box does not match (fitted and centred, upright)", async () => {
    const { deflateSync } = await import("node:zlib");
    const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(400, 0); ihdr.writeUInt32BE(100, 4); ihdr[8] = 8; ihdr[9] = 6;
    const raw = Buffer.alloc(100 * (1 + 400 * 4));
    const wide = "data:image/png;base64," + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
    const a: Annotation = { id: "s", kind: "signature", ...base, box: { x: 20, y: 50, width: 100, height: 100 }, png: wide };
    const doc = await PDFDocument.load(await buildDocument(sources, [{ ...page, rotation: 90 as const }], [], [a]));
    const contents = doc.getPage(0).node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [doc.getPage(0).node.get(PDFName.of("Contents"))];
    const text = refs.map((r) => new TextDecoder("latin1").decode(decodePDFRawStream(doc.context.lookup(r) as PDFRawStream).decode())).join("\n");
    const cm = [...text.matchAll(/([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+) cm/g)].map((m) => m.slice(1, 7).map(Number));
    const scale = cm.find(([a0, b, c, d0, e, f0]) => a0 === 100 && d0 === 25 && b === 0 && c === 0 && e === 0 && f0 === 0);
    expect(scale).toBeDefined(); // fitted 100x25, not 100x100
    expect(cm.some(([a0, b, c, d0]) => Math.abs(a0) < 1e-6 && Math.abs(d0) < 1e-6 && Math.abs(b - 1) < 1e-6 && Math.abs(c + 1) < 1e-6)).toBe(true);
  });
});
