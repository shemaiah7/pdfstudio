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
  it("has the favicon links and the hero heading", () => {
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(html).toContain('href="/icons/favicon-32.png"');
    expect(html).toContain("<h1>SentinelPDF for Mac and Windows</h1>");
  });
  it("keeps static version and size text as the fallback when the release fetch fails", () => {
    expect(html).toContain("Version 1.0.2 &middot; 218 MB &middot; macOS 12+ (Apple silicon and Intel)");
    expect(html).toContain('var version = "1.0.2"');
    expect(html).toContain('size: "106 MB"');
  });
  it("supports dark mode and phones", () => {
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('name="viewport"');
  });
});
