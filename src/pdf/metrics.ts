import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import type { Measure } from "./layout";
import type { EditFont } from "./types";
import { toWinAnsi } from "./winansi";

const STANDARD: Record<EditFont, StandardFonts> = {
  sans: StandardFonts.Helvetica,
  "sans-bold": StandardFonts.HelveticaBold,
  serif: StandardFonts.TimesRoman,
};

let fonts: Promise<Record<EditFont, PDFFont>> | null = null;

function loadFonts() {
  fonts ??= (async () => {
    const doc = await PDFDocument.create();
    return {
      sans: await doc.embedFont(STANDARD.sans),
      "sans-bold": await doc.embedFont(STANDARD["sans-bold"]),
      serif: await doc.embedFont(STANDARD.serif),
    };
  })();
  return fonts;
}

/** Measurer backed by the same pdf-lib font metrics the export uses. */
export async function measureFor(font: EditFont): Promise<Measure> {
  const f = (await loadFonts())[font];
  return (text, size) => f.widthOfTextAtSize(toWinAnsi(text), size);
}
