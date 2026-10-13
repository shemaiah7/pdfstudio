import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TERMS_CHECKBOX, TERMS_VERSION } from "./terms";

const html = readFileSync(resolve(__dirname, "../../public/terms.html"), "utf8");

describe("public/terms.html", () => {
  it("contains the verbatim checkbox sentence", () => { expect(html).toContain(TERMS_CHECKBOX); });
  it("shows the current terms version", () => { expect(html).toContain(TERMS_VERSION); });
  it("carries the draft marker comment", () => { expect(html).toContain("<!-- DRAFT — legal review recommended before launch -->"); });
});
