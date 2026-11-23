import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { repairIfDamaged } from "./repair";
import { loadFixture } from "../test/loadFixture";
import { openPdf } from "../test/pdfjs";
import { damagedPdf } from "../test/damagedFixture";

describe("repairIfDamaged", () => {
  it("returns healthy files untouched", async () => {
    const bytes = loadFixture("three");
    const res = await repairIfDamaged(bytes);
    expect(res.repaired).toBe(false);
    expect(res.missing).toBe(0);
    expect(res.bytes).toBe(bytes);
  });

  it("recovers the readable pages of a file whose page tree points at a missing page", async () => {
    const res = await repairIfDamaged(await damagedPdf());
    expect(res.repaired).toBe(true);
    expect(res.missing).toBe(1);
    expect((await PDFDocument.load(res.bytes)).getPageCount()).toBe(3);
  });

  it("produces a file pdf.js reads end to end", async () => {
    const res = await repairIfDamaged(await damagedPdf());
    const pdf = await openPdf(res.bytes);
    expect(pdf.numPages).toBe(3);
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      await expect(page.getOperatorList()).resolves.toBeTruthy();
    }
  });
});
