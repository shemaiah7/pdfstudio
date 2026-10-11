import type { EditFont } from "../pdf/types";
export interface FontInfo { name?: string; serif?: boolean; monospace?: boolean; bold?: boolean; italic?: boolean; cssFamily?: string; cssWeight?: number; cssStyle?: string }

export function matchFont(info: FontInfo): EditFont {
  if (info.name === "ocr") return "helvetica";
  const hay = `${info.name ?? ""} ${info.cssFamily ?? ""}`;
  const mono = info.monospace || /courier|mono/i.test(hay);
  const serif = !mono && (info.serif || (/times|georgia|garamond|book|roman|serif/i.test(hay) && !/sans/i.test(hay)));
  const family = mono ? "courier" : serif ? "times" : "helvetica";
  const bold = !!info.bold || (info.cssWeight ?? 0) >= 600 || /bold|black|heavy|semibold/i.test(hay);
  const italic = !!info.italic || info.cssStyle === "italic" || /italic|oblique/i.test(hay);
  if (family === "times") return bold && italic ? "times-bolditalic" : bold ? "times-bold" : italic ? "times-italic" : "times";
  const base = family;
  return bold && italic ? `${base}-boldoblique` : bold ? `${base}-bold` : italic ? `${base}-oblique` : base;
}
