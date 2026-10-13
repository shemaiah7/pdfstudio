import { describe, it, expect } from "vitest";
import { formatPassages, keywordPassages, overview, NO_MATCH, pagesNamed, looksGarbled } from "./grounding";

describe("formatPassages", () => {
  it("prefixes each passage with its page and joins with blank lines", () => {
    expect(formatPassages([{ page: 2, text: "warfarin 5 mg" }, { page: 4, text: "INR 2.5" }])).toBe("[p. 2] warfarin 5 mg\n\n[p. 4] INR 2.5");
  });
  it("returns an empty string for no passages", () => { expect(formatPassages([])).toBe(""); });
  it("stops at a passage boundary before exceeding maxChars", () => {
    const out = formatPassages([{ page: 1, text: "a".repeat(40) }, { page: 2, text: "b".repeat(40) }, { page: 3, text: "c".repeat(40) }], 100);
    expect(out).toContain("[p. 1]"); expect(out).toContain("[p. 2]"); expect(out).not.toContain("[p. 3]");
  });
  it("truncates a single oversized passage", () => {
    expect(formatPassages([{ page: 1, text: "x".repeat(50) }], 20).length).toBeLessThanOrEqual(20);
  });
});

describe("keywordPassages", () => {
  const pages = [
    { page: 1, text: "Cardiology note. Troponin elevated. Aspirin given." },
    { page: 2, text: "Dermatology note. Rash on forearm after gardening. Topical corticosteroid prescribed." },
    { page: 3, text: "Follow-up: rash improved; continue corticosteroid for one week." },
  ];
  it("ranks pages by distinct term hits and windows around the first hit", () => {
    const r = keywordPassages(pages, "corticosteroid rash");
    expect(r.map((p) => p.page)).toEqual([2, 3]);
    expect(r[0].text).toContain("Rash on forearm");
  });
  it("returns an empty list when nothing matches or the query has no terms", () => {
    expect(keywordPassages(pages, "zzzz")).toEqual([]);
    expect(keywordPassages(pages, "the and")).toEqual([]);
  });
  it("limits results and windows to 600 characters", () => {
    const long = { page: 9, text: "filler ".repeat(200) + "troponin " + "filler ".repeat(200) };
    const r = keywordPassages([long, ...pages.slice(1)], "troponin", 1);
    expect(r).toHaveLength(1);
    expect(r[0].text.length).toBeLessThanOrEqual(600);
    expect(r[0].text).toContain("troponin");
  });
});

describe("overview", () => {
  it("names the document and page count only", () => {
    expect(overview("note.pdf", 7)).toBe("Document: note.pdf, 7 pages.");
  });
  it("exports the no-match string", () => { expect(NO_MATCH).toBe("No passage in the document matched that query."); });
});

describe("pagesNamed", () => {
  it.each([
    ["what does page 4 say", 10, [4]],
    ["PAGE 4", 10, [4]],
    ["pages 4 and 6", 10, [4, 6]],
    ["see pages 2, 5 and 7", 10, [2, 5, 7]],
    ["p. 4 please", 10, [4]],
    ["p4", 10, [4]],
    ["pg 3", 10, [3]],
    ["the aide statement on page four", 10, [4]],
    ["page Twenty", 25, [20]],
    ["page 4 and page 4 again", 10, [4]],
    ["page 12 and page 3", 10, [3]],
    ["page 0", 10, []],
    ["pages 1, 2, 3 and 4", 10, [1, 2, 3]],
    ["it is 4 pages long", 10, []],
    ["turn the page", 10, []],
    ["page", 10, []],
  ])("%s", (q, n, want) => { expect(pagesNamed(q, n)).toEqual(want); });
});

describe("looksGarbled", () => {
  it("is false for clean typed English", () => {
    expect(looksGarbled("The patient was seen in clinic today for follow-up of hypertension. Blood pressure is well controlled on lisinopril 10 mg daily.")).toBe(false);
  });
  it("is false for short text", () => { expect(looksGarbled("Rsdnt fnd 0n flr")).toBe(false); expect(looksGarbled("")).toBe(false); });
  it("is true for Tesseract output on handwriting", () => {
    expect(looksGarbled("Rsdnt fnd 0n flr ,, l/ wt~ pt c/o lft hp ;; ||")).toBe(true);
    expect(looksGarbled("Rsdnt fnd 0n flr ,, l/ wt~ pt c/o lft hp ;; || Hz rsdnt ntd 2 b hrt ~~ stmnt dd")).toBe(true);
  });
});
