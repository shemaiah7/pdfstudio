import { PDFBool, PDFDocument, PDFFont, PDFName, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { placePieces } from "../edit/layout";
import { toWinAnsi } from "./winansi";
import { ensureAcroFormDR, isDegenerate, writeAnnotations } from "./annotations";
import { applyFormValues, readFieldsFromDoc, rebuildAcroForm } from "./formFill";
import { addInvisibleText, withoutCoveredWords } from "../ocr/textLayer";
import type { OcrPage } from "../ocr/types";
import { sweepUnreachable } from "./sweep";
import { flattenPage, type RasterCover } from "../edit/flatten";
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

/** `covers` (crop-relative, y up) are painted onto the raster so covered text is not recoverable from the image either. */
export type PageRasterizer = (source: SourceFile, pageIndex: number, dpi: number, covers: RasterCover[]) => Promise<{ png: Uint8Array; widthPt: number; heightPt: number }>;
export interface BuildOptions {
  /** When given, edited pages (typed or scanned) are flattened: original raster + edits + invisible text, so covered text is not extractable. */
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
  let flattenWarned = false;
  let deepOmitWarned = false;
  let anyFlattened = false;
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
    const fontCache = new Map<EditFont, PDFFont>();
    const fontFor = async (f: EditFont) => fontCache.get(f) ?? (fontCache.set(f, await out.embedFont(STANDARD_FONTS[f])), fontCache.get(f)!);
    const faces = new Set<EditFont>();
    for (const e of pageEdits) { if (e.kind === "line") for (const r of e.runs ?? []) faces.add(r.font); else faces.add(normalizeFont(e.font)); }
    for (const f of faces) await fontFor(f);
    const measures = (f: EditFont) => (t: string, sz: number) => fontCache.get(f)!.widthOfTextAtSize(toWinAnsi(t), sz);
    // One layout per edit, shared by the covers handed to the rasterizer, the drawing, and the OCR omission below.
    const plans = pageEdits.map((e) => ({ e, ...placePieces(e, measures) }));
    const drawEdits = async () => {
      for (const { e, pieces, boxes } of plans) {
        for (const b of boxes) copied.drawRectangle({ x: b.x + ox, y: b.y + oy, width: b.width, height: b.height, color: rgb(...(e.background ?? [1, 1, 1])) });
        // The Insert gate prevents overflow edits; if one slips through, every piece is drawn anyway.
        for (const p of pieces) {
          const drawOpts = { x: p.x + ox, y: p.baseline + oy, size: p.fontSize, font: fontCache.get(p.font)!, color: rgb(p.color[0], p.color[1], p.color[2]) };
          // Draw exactly the string that was measured.
          const drawn = toWinAnsi(p.text);
          try { copied.drawText(drawn, drawOpts); }
          catch { copied.drawText(drawn.replace(/[^\x20-\x7E]/g, "?"), drawOpts); }
        }
      }
    };
    const ocr = ocrPages?.get(entry.id);
    const deepOcr = ocr?.engine === "claude" && pageEdits.length > 0;
    // Edited pages (typed or scanned) are flattened when a rasterizer is supplied.
    if (pageEdits.length && opts.rasterize && opts.editedText) {
      try {
        // Deep OCR word boxes are synthetic (evenly stacked lines), so text under an edit cannot be reliably omitted: no invisible layer for those.
        const items = deepOcr ? [] : (await opts.editedText(source, entry.sourcePageIndex)).filter((i) => i.str.trim() && !(EDIT_FONTS as readonly string[]).includes(i.fontName));
        const covers: RasterCover[] = plans.flatMap((p) => p.boxes.map((box) => ({ box, color: p.e.background ?? [1, 1, 1] as [number, number, number] })));
        const raster = await opts.rasterize(source, entry.sourcePageIndex, FLATTEN_DPI, covers);
        helv ??= await out.embedFont(StandardFonts.Helvetica);
        await flattenPage(out, copied, { ...raster, items, cropOrigin: { x: ox, y: oy } }, helv, drawEdits);
        flattened = true;
        anyFlattened = true;
      } catch {
        if (!flattenWarned) onWarning?.("Saved without flattening; covered text may remain in the file.");
        flattenWarned = true;
      }
    }
    if (pageEdits.length && !flattened) await drawEdits();

    const pageAnns = annotations.filter((a) => a.pageEntryId === entry.id);
    if (pageAnns.length) {
      helv ??= await out.embedFont(StandardFonts.Helvetica);
      await writeAnnotations(out, copied, pageAnns, { x: ox, y: oy }, { helv }, (((base + entry.rotation) % 360) + 360) % 360);
      if (pageAnns.some((a) => a.kind === "freetext" && !isDegenerate(a))) wroteFreeText = true;
    }

    if (ocr && deepOcr) {
      if (!deepOmitWarned) onWarning?.("Searchable text left out of edited Deep OCR pages.");
      deepOmitWarned = true;
    } else if (ocr && !flattened) { // a flattened page already carries its (edited) invisible layer
      helv ??= await out.embedFont(StandardFonts.Helvetica);
      try { addInvisibleText(copied, helv, withoutCoveredWords(ocr, plans.flatMap((p) => p.boxes)), { x: ox, y: oy }); }
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
  // Flattened pages leave their original resources (scan images, Form XObjects) registered but unreferenced; drop them so they can't be recovered.
  // Field appearances are regenerated first so the sweep sees (and keeps) the final streams.
  const sweepIfFlattened = () => { if (anyFlattened) sweepUnreachable(out); };
  if (!anyFields) { sweepIfFlattened(); return out.save({ updateFieldAppearances: false }); }
  try {
    out.getForm().updateFieldAppearances();
    sweepIfFlattened();
    return await out.save({ updateFieldAppearances: false });
  } catch {
    // Text outside WinAnsi can't be drawn into a field appearance; let the viewer redraw it instead.
    out.getForm().acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    onWarning?.("Some form text will be redrawn by the PDF viewer");
    sweepIfFlattened();
    return out.save({ updateFieldAppearances: false });
  }
}
