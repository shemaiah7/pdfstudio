import { describe, it, expect } from "vitest";
import { splitCitations } from "./citations";

describe("splitCitations", () => {
  it("turns (p. N) into page tokens", () => {
    expect(splitCitations("Total is $5 (p. 3). See (p. 7-8) too.")).toEqual([
      { type: "text", value: "Total is $5 " }, { type: "page", page: 3 },
      { type: "text", value: ". See " }, { type: "page", page: 7 }, { type: "text", value: " too." },
    ]);
  });
  it("passes text without citations through", () => {
    expect(splitCitations("plain")).toEqual([{ type: "text", value: "plain" }]);
  });
});
