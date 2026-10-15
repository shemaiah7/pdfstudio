import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const VISIBLE = ["index.html", "public/manifest.webmanifest", "public/terms.html", "src/components/DropZone.tsx",
  "src/components/DefaultAppDialog.tsx", "src/components/DefaultAppPrompt.tsx", "src/components/InstallButton.tsx",
  "src/pwa/defaultApp.ts", "src/account/terms.ts", "src/components/account/TermsDialog.tsx"];

describe("brand", () => {
  it.each(VISIBLE)("%s says SentinelPDF, never PDF Studio", (p) => {
    const s = read(p);
    expect(s).not.toContain("PDF Studio");
    expect(s).toContain("SentinelPDF");
  });
  it("manifest keeps its id so installed copies stay the same app", () => {
    const m = JSON.parse(read("public/manifest.webmanifest"));
    expect(m.id).toBe("/");
    expect(m.name).toBe("SentinelPDF");
    expect(m.short_name).toBe("SentinelPDF");
  });
});
