import { describe, it, expect } from "vitest";
import { toWinAnsi } from "./winansi";

describe("toWinAnsi", () => {
  it("keeps WinAnsi punctuation", () => { expect(toWinAnsi("a—b…")).toBe("a—b…"); });
  it("replaces unencodable characters", () => { expect(toWinAnsi("a→b")).toBe("a?b"); });
});
