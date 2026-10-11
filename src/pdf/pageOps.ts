import { PDFBool, PDFDocument, PDFFont, PDFName, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { layoutInBoxes } from "./layout";
import { toWinAnsi } from "./winansi";
import { ensureAcroFormDR, isDegenerate, writeAnnotations } from "./annotations";
import { applyFormValues, readFieldsFromDoc, rebuildAcroForm } from "./formFill";
import { addInvisibleText, withoutCoveredWords } from "../ocr/textLayer";
import type { OcrPage } from "../ocr/types";
import { flattenPage } from "../edit/flatten";
import type { TextItemBox } from "./text";
import { EDIT_FONTS, STANDARD_FONTS, normalizeFont } from "./fonts";
import type { Annotation, Edit, EditFont, FormValues, PageEntry, Rotation, SourceFile, SourceId } from "./types";

export function addRotation(a: Rotation, delta: 90 | -90 | 180): Rotation {
  return (((a + delta) % 360) + 360) % 360 as Rotation;
}

export async function countPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  return doc.getPageCount();
}

export type PageRasterizer = (source: SourceFile, pageIndex: number, dpi: number) => Promise<{ png: Uint8Array; widthPt: number; heightPt: number }>;
export interface BuildOptions {
  /** When given, edited native pages are flattened: original raster + edits + invisible text, so covered text is not extractable. */
  rasterize?: PageRasterizer;
  editedText?: (source: SourceFile, pageIndex: number) => Promise<TextItemBox[]>;
}
const FLATTEN_DPI = 200;

export async function buildDocument(
  sources: Map<SourceId, SourceFile>,
  pages: PageEntry[],
  edits: Edit[] = [],
  annotations: Annotation[] = [],
  formValues: FormValues = new Map(),
  onWarning?: (msg: string) => void,
  ocrPages?: Map<string, OcrPage>,
  opts: BuildOptions = {},
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const loaded = new Map<SourceId, PDFDocument>();
  let helv: PDFFont | undefined;
  let wroteFreeText = false;
  let ocrWarned = false;
  let deepOmitWarned = false;
  const copiedBySource = new Map<SourceId, PDFPage[]>();

  for (const entry of pages) {
    const source = sources.get(entry.sourceId);
    if (!source) throw new Error(`Unknown source ${entry.sourceId}`);
    if (entry.sourcePageIndex >= source.pageCount) {
      throw new Error(
        `${source.name} has no page ${entry.sourcePageIndex + 1}`,
      );
    }
    let doc = loaded.get(entry.sourceId);
    if (!doc) {
      doc = await PDFDocument.load(source.bytes);
      loaded.set(entry.sourceId, doc);
    }
    const [copied] = await out.copyPages(doc, [entry.sourcePageIndex]);
    const base = copied.getRotation().angle;
    copied.setRotation(degrees((((base + entry.rotation) % 360) + 360) % 360));
    out.addPage(copied);
    const list = copiedBySource.get(entry.sourceId) ?? [];
    list.push(copied);
    copiedBySource.set(entry.sourceId, list);

    // Selection boxes are relative to the crop box origin (pdf.js page.view).
    const { x: ox, y: oy } = copied.getCropBox();
    const pageEdits = edits.filter((e) => e.pageEntryId === entry.id);
    let flattened = false;
    const drawEdits = async () => {
      const fontCache = new Map<EditFont, PDFFont>();
      const fontFor = async (f: EditFont) => fontCache.get(f) ?? (fontCache.set(f, await out.embedFont(STANDARD_FONTS[f])), fontCache.get(f)!);
      for (const e of pageEdits) {
        for (const b of e.boxes) copied.drawRectangle({ x: b.x + ox, y: b.y + oy, width: b.width, height: b.height, color: rgb(...(e.background ?? [1, 1, 1])) });
        const face = normalizeFont(e.font);
        const font = await fontFor(face);
        const width = (t: string, s: number) => font.widthOfTextAtSize(toWinAnsi(t), s);
        // The Insert gate prevents overflow edits; if one slips through, draw every line anyway.
        const { lines, fontSize } = layoutInBoxes(e.text, e.boxes, e.fontSize, width, { keepOverflow: true });
        const color = rgb(e.color[0], e.color[1], e.color[2]);
        for (const line of lines) {
          const drawOpts = { x: line.x + ox, y: line.baseline + oy, size: fontSize, font, color };
          // Draw exactly the string that was measured.
          const drawn = toWinAnsi(line.text);
          try { copied.drawText(drawn, drawOpts); }
          catch { copied.drawText(drawn.replace(/[^\x20-\x7E]/g, "?"), drawOpts); }
        }
      }
    };
    // Edited native pages (not OCR scans, whose text is already a separate layer) are flattened when a rasterizer is supplied.
    if (pageEdits.length && opts.rasterize && opts.editedText && !ocrPages?.get(entry.id) && !pageEdits.some((e) => e.source === "ocr")) {
      const items = (await opts.editedText(source, entry.sourcePageIndex)).filter((i) => i.str.trim() && !(EDIT_FONTS as readonly string[]).includes(i.fontName));
      const raster = await opts.rasterize(source, entry.sourcePageIndex, FLATTEN_DPI);
      helv ??= await out.embedFont(StandardFonts.Helvetica);
      await flattenPage(out, copied, { ...raster, items, cropOrigin: { x: ox, y: oy } }, helv, drawEdits);
      flattened = true;
    }
    if (pageEdits.length && !flattened) await drawEdits();

    const pageAnns = annotations.filter((a) => a.pageEntryId === entry.id);
    if (pageAnns.length) {
      helv ??= await out.embedFont(StandardFonts.Helvetica);
      await writeAnnotations(out, copied, pageAnns, { x: ox, y: oy }, { helv }, (((base + entry.rotation) % 360) + 360) % 360);
      if (pageAnns.some((a) => a.kind === "freetext" && !isDegenerate(a))) wroteFreeText = true;
    }

    const ocr = ocrPages?.get(entry.id);
    if (ocr && ocr.engine === "claude" && pageEdits.length > 0) {
      // Deep OCR word boxes are synthetic (evenly stacked lines), so text under an edit cannot be reliably omitted.
      if (!deepOmitWarned) onWarning?.("Searchable text left out of edited Deep OCR pages.");
      deepOmitWarned = true;
    } else if (ocr) {
      helv ??= await out.embedFont(StandardFonts.Helvetica);
      try { addInvisibleText(copied, helv, withoutCoveredWords(ocr, pageEdits.flatMap((e) => e.boxes)), { x: ox, y: oy }); }
      catch { if (!ocrWarned) onWarning?.("Saved without searchable text layer."); ocrWarned = true; }
    }
  }

  let anyFields = false;
  for (const [id, copiedPages] of copiedBySource) {
    const srcDoc = loaded.get(id)!;
    try {
      const defs = readFieldsFromDoc(srcDoc);
      if (!defs.length) continue;
      const { renames } = rebuildAcroForm(out, srcDoc, copiedPages);
      const failed = applyFormValues(out, formValues.get(id) ?? new Map(), defs, renames);
      if (failed.length) onWarning?.(`Could not save fields: ${failed.join(", ")}`);
      if (renames.size) onWarning?.(`Duplicate form field names in ${sources.get(id)!.name} were renamed`);
      anyFields = true;
    } catch {
      onWarning?.(`Form values for ${sources.get(id)!.name} could not be saved`);
    }
  }

  if (wroteFreeText && helv) ensureAcroFormDR(out, helv);
  if (!anyFields) return out.save({ updateFieldAppearances: false });
  try {
    return await out.save({ updateFieldAppearances: true });
  } catch {
    // Text outside WinAnsi can't be drawn into a field appearance; let the viewer redraw it instead.
    out.getForm().acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    onWarning?.("Some form text will be redrawn by the PDF viewer");
    return out.save({ updateFieldAppearances: false });
  }
}
