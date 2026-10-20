import { describe, it, expect } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from "pdf-lib";
import { decryptIfNeeded, computeFileKey, PasswordRequiredError } from "./decrypt";
import { aesDecryptBlock, aesEncryptBlock, md5 } from "./crypto";
import { readFieldsFromDoc } from "./formFill";
import { buildDocument } from "./pageOps";
import type { SourceFile } from "./types";
import { openPdf } from "../test/pdfjs";
import { loadFixture } from "../test/loadFixture";
import { loadEncryptedFixture } from "../test/loadEncryptedFixture";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16));

const FIXTURES = ["encrypted-rc4-40", "encrypted-rc4-128", "encrypted-aes-128", "encrypted-aes-256-r5", "encrypted-aes-256", "encrypted-aes-128-objstm"];

async function pageContent(doc: PDFDocument, i: number): Promise<string> {
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

async function pageText(bytes: Uint8Array, pageNo: number): Promise<string> {
  const pdf = await openPdf(bytes);
  const page = await pdf.getPage(pageNo);
  const tc = await page.getTextContent();
  return tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
}

describe.each(FIXTURES)("decryptIfNeeded %s", (name) => {
  it("produces plaintext that pdf-lib, pdf.js and the form reader all accept", async () => {
    const { bytes, wasEncrypted } = await decryptIfNeeded(loadEncryptedFixture(name));
    expect(wasEncrypted).toBe(true);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    expect(doc.getPageCount()).toBe(2);
    expect(doc.context.trailerInfo.Encrypt).toBeUndefined();
    expect(doc.getTitle()).toBe("Encrypted fixture");
    expect(await pageText(bytes, 1)).toContain("encrypted:0");
    expect(readFieldsFromDoc(doc).map((f) => f.name)).toContain("name");
    expect(doc.getForm().getTextField("name").getText()).toBe("Alice");
    expect(await pageContent(doc, 0)).toContain("(encrypted:0) Tj");
  });

  it("is deterministic", async () => {
    const a = await decryptIfNeeded(loadEncryptedFixture(name));
    const b = await decryptIfNeeded(loadEncryptedFixture(name));
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});

describe("decryptIfNeeded edge cases", () => {
  it("returns unencrypted input untouched", async () => {
    const bytes = loadFixture("three");
    const out = await decryptIfNeeded(bytes);
    expect(out.bytes).toBe(bytes);
    expect(out.wasEncrypted).toBe(false);
  });

  it("rejects a user-password file with PasswordRequiredError", async () => {
    await expect(decryptIfNeeded(loadEncryptedFixture("encrypted-userpw-aes-128"))).rejects.toBeInstanceOf(PasswordRequiredError);
  });

  it("does not leave console.warn silenced", async () => {
    const orig = console.warn;
    await decryptIfNeeded(loadEncryptedFixture("encrypted-aes-128-objstm"));
    expect(console.warn).toBe(orig);
  });

  it("round-trips through buildDocument", async () => {
    const { bytes } = await decryptIfNeeded(loadEncryptedFixture("encrypted-aes-256"));
    const src: SourceFile = { id: "e", name: "e.pdf", bytes, pageCount: 2 };
    const out = await buildDocument(new Map([["e", src]]), [
      { id: "e-0", sourceId: "e", sourcePageIndex: 0, rotation: 0 },
      { id: "e-1", sourceId: "e", sourcePageIndex: 1, rotation: 0 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(await pageText(out, 2)).toContain("encrypted:1");
  });
});

describe("computeFileKey", () => {
  const KNOWN: Record<string, string> = {
    "encrypted-rc4-40": "589afd1bb1",
    "encrypted-rc4-128": "6a94831b13779bed5b44277434f78bcc",
    "encrypted-aes-128": "6a94831b13779bed5b44277434f78bcc",
    "encrypted-aes-256-r5": "f9921cb0eaa3bb42f68e85dae54be0eedc27b1641e77a2072591c30d6a205a07",
    "encrypted-aes-256": "ada5ad30419b456b937c9b6067e16de4d72a21e0144e43ab4090b40d1225d919",
    "encrypted-aes-128-objstm": "ebd622abfd06a442296aef42224d5774",
  };
  it.each(Object.entries(KNOWN))("%s", async (name, expected) => {
    const { PDFParser } = await import("pdf-lib");
    const orig = console.warn;
    console.warn = () => {};
    let ctx;
    try { ctx = await PDFParser.forBytesWithOptions(loadEncryptedFixture(name), Infinity, false, false).parseDocument(); } finally { console.warn = orig; }
    const encrypt = ctx.lookup(ctx.trailerInfo.Encrypt!, PDFDict);
    const idArr = ctx.lookup(ctx.trailerInfo.ID!, PDFArray);
    const first = ctx.lookup(idArr.get(0)) as PDFString | PDFHexString;
    expect(encrypt.lookup(PDFName.of("Filter"))).toBe(PDFName.of("Standard"));
    expect(hex(await computeFileKey(encrypt, first.asBytes()))).toBe(expected);
  });
});

describe("crypto primitives", () => {
  it("md5 matches RFC 1321 vectors", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(hex(md5(enc("")))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(hex(md5(enc("abc")))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(hex(md5(enc("12345678901234567890123456789012345678901234567890123456789012345678901234567890")))).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });

  it("AES-128 matches FIPS-197 C.1 and decrypts back", () => {
    const key = unhex("000102030405060708090a0b0c0d0e0f");
    const pt = unhex("00112233445566778899aabbccddeeff");
    const ct = aesEncryptBlock(key, pt);
    expect(hex(ct)).toBe("69c4e0d86a7b0430d8cdb78070b4c55a");
    expect(hex(aesDecryptBlock(key, ct))).toBe(hex(pt));
  });

  it("AES-256 matches FIPS-197 C.3", () => {
    const key = unhex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    const pt = unhex("00112233445566778899aabbccddeeff");
    const ct = aesEncryptBlock(key, pt);
    expect(hex(ct)).toBe("8ea2b7ca516745bfeafc49904b496089");
    expect(hex(aesDecryptBlock(key, ct))).toBe(hex(pt));
  });
});
