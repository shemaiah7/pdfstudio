import { describe, it, expect } from "vitest";
import { linesFromItems, hasAnyText } from "./text";

const item = (str: string, x: number, y: number, w = 10) => ({ str, transform: [10, 0, 0, 10, x, y], width: w, height: 10 });

describe("linesFromItems", () => {
  it("joins items on the same baseline in x order", () => {
    expect(linesFromItems([item("world", 60, 700), item("Hello", 10, 700)])).toBe("Hello world");
  });
  it("separates lines by baseline, top to bottom", () => {
    expect(linesFromItems([item("second", 10, 680), item("first", 10, 700)])).toBe("first\nsecond");
  });
  it("keeps two columns on the same baseline readable left to right without merging words", () => {
    const text = linesFromItems([item("Left", 10, 700, 30), item("col", 45, 700, 20), item("Right", 300, 700, 40), item("col", 345, 700, 20)]);
    expect(text).toBe("Left col Right col");
  });
  it("does not add a space when items touch", () => {
    expect(linesFromItems([item("Hel", 10, 700, 20), item("lo", 30, 700, 10)])).toBe("Hello");
  });
  it("ignores empty items and tolerates small baseline jitter", () => {
    expect(linesFromItems([item("a", 10, 700), item("", 20, 700), item("b", 25, 701)])).toBe("a b");
  });
});

describe("hasAnyText", () => {
  it("is false for whitespace-only pages", () => {
    expect(hasAnyText([{ text: " \n" }, { text: "" }])).toBe(false);
    expect(hasAnyText([{ text: "x" }])).toBe(true);
  });
});
