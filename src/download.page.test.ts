import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(__dirname, "../public/download.html"), "utf8");
const REL = "https://github.com/shemaiah7/pdfstudio/releases/latest/download/";

describe("public/download.html", () => {
  it("links both installers", () => {
    expect(html).toContain(`${REL}SentinelPDF-mac.dmg`);
    expect(html).toContain(`${REL}SentinelPDF-windows.exe`);
  });
  it("names the app and explains the Windows warning and requirements", () => {
    expect(html).toContain("<title>Download SentinelPDF</title>");
    expect(html).toContain("More info");
    expect(html).toContain("Run anyway");
    expect(html).toContain("macOS 12");
    expect(html).toContain("Windows 10");
  });
  it("supports dark mode and phones", () => {
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('name="viewport"');
  });
});
