import { StandardFonts } from "pdf-lib";
import type { EditFont, LegacyEditFont } from "./types";

export const EDIT_FONTS = ["helvetica", "helvetica-bold", "helvetica-oblique", "helvetica-boldoblique", "times", "times-bold", "times-italic", "times-bolditalic", "courier", "courier-bold", "courier-oblique", "courier-boldoblique"] as const satisfies readonly EditFont[];
const LEGACY: Record<LegacyEditFont, EditFont> = { sans: "helvetica", "sans-bold": "helvetica-bold", serif: "times" };
export function normalizeFont(f: EditFont | LegacyEditFont | string): EditFont {
  if ((EDIT_FONTS as readonly string[]).includes(f)) return f as EditFont;
  return LEGACY[f as LegacyEditFont] ?? "helvetica";
}
export const STANDARD_FONTS: Record<EditFont, StandardFonts> = {
  helvetica: StandardFonts.Helvetica, "helvetica-bold": StandardFonts.HelveticaBold, "helvetica-oblique": StandardFonts.HelveticaOblique, "helvetica-boldoblique": StandardFonts.HelveticaBoldOblique,
  times: StandardFonts.TimesRoman, "times-bold": StandardFonts.TimesRomanBold, "times-italic": StandardFonts.TimesRomanItalic, "times-bolditalic": StandardFonts.TimesRomanBoldItalic,
  courier: StandardFonts.Courier, "courier-bold": StandardFonts.CourierBold, "courier-oblique": StandardFonts.CourierOblique, "courier-boldoblique": StandardFonts.CourierBoldOblique,
};
const FAMILY_CSS = { helvetica: "Helvetica, Arial, sans-serif", times: "'Times New Roman', Times, serif", courier: "'Courier New', Courier, monospace" } as const;
export function fontFamily(f: EditFont): "helvetica" | "times" | "courier" { return f.split("-")[0] as "helvetica" | "times" | "courier"; }
export const FONT_CSS = Object.fromEntries(EDIT_FONTS.map((f) => {
  const bold = /bold/.test(f), italic = /italic|oblique/.test(f);
  return [f, `${italic ? "italic " : ""}${bold ? 700 : 400} 1px ${FAMILY_CSS[fontFamily(f)]}`];
})) as Record<EditFont, string>;
