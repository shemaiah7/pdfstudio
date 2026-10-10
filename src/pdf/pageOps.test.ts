import { describe, it, expect } from "vitest";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { buildDocument, countPages, addRotation } from "./pageOps";
import type { SourceFile, PageEntry } from "./types";
import { loadFixture } from "../test/loadFixture";

function src(id: string, name: "three" | "two" | "rotated", pageCount: number): SourceFile {
  return { id, name: `${name}.pdf`, bytes: loadFixture(name), pageCount };
}

function entry(sourceId: string, i: number, rotation: 0 | 90 | 180 | 270 = 0): PageEntry {
  return { id: `${sourceId}-${i}`, sourceId, sourcePageIndex: i, rotation };
}

async function markers(bytes: Uint8Array): Promise<string[]> {
  // pdf-lib writes page contents as an array of Flate-compressed streams whose text
  // is a hex string (`<74687265...> Tj`). Decode every stream and read the marker back.
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of doc.getPages()) {
    const contents = doc.context.lookup(page.node.Contents() as any);
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    let text = "";
    for (const ref of refs) {
      const stream = doc.context.lookup(ref as any);
      if (stream instanceof PDFRawStream) {
        text += new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
      }
    }
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
