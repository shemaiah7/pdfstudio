import type { FontInfo } from "./fontMatch";
interface PdfFontObj { name?: string; isSerifFont?: boolean; isMonospace?: boolean; bold?: boolean; italic?: boolean; black?: boolean }
export function fontInfoFor(page: { commonObjs: { has(id: string): boolean; get(id: string): unknown } }, fontName: string, styles: Record<string, { fontFamily?: string }>): FontInfo {
  if (fontName === "ocr") return { name: "ocr" };
  try {
    if (page.commonObjs.has(fontName)) {
      const f = page.commonObjs.get(fontName) as PdfFontObj | null;
      if (f) return { name: f.name, serif: !!f.isSerifFont, monospace: !!f.isMonospace, bold: !!(f.bold || f.black), italic: !!f.italic };
    }
  } catch { /* fall through */ }
  const fam = styles[fontName]?.fontFamily;
  return fam ? { cssFamily: fam } : {};
}
