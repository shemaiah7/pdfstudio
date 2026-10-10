import { describe, it, expect } from "vitest";
import { outputName } from "./download";

describe("outputName", () => {
  it("strips .pdf case-insensitively and appends suffix", () => {
    expect(outputName("Report.PDF", "edited")).toBe("Report-edited.pdf");
    expect(outputName("scan", "pages")).toBe("scan-pages.pdf");
  });
});
