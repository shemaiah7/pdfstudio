import { describe, it, expect } from "vitest";
import { formatPassages, keywordPassages, overview, NO_MATCH } from "./grounding";

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
  it("names the document, page count and the first 300 characters", () => {
    const o = overview("note.pdf", 7, "x".repeat(400));
    expect(o.startsWith("Document: note.pdf, 7 pages. Begins: ")).toBe(true);
    expect(o.length).toBe("Document: note.pdf, 7 pages. Begins: ".length + 300);
  });
  it("exports the no-match string", () => { expect(NO_MATCH).toBe("No passage in the document matched that query."); });
});
