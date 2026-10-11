// Pure pdf-lib form helpers; kept free of store imports so pageOps can use them without an import cycle.
import { PDFDocument, PDFPage, PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from "pdf-lib";
import type { Box, FormValue } from "./types";

export type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "unsupported";
export interface FieldDef { name: string; type: FieldType; options?: string[]; onValue?: string; widgets: { pageIndex: number; rect: Box }[] }

export function readFieldsFromDoc(doc: PDFDocument): FieldDef[] {
  const annotPage = new Map<PDFDict, number>();
  doc.getPages().forEach((pg, i) => {
    for (const r of pg.node.Annots()?.asArray() ?? []) {
      const d = doc.context.lookup(r);
      if (d instanceof PDFDict && !annotPage.has(d)) annotPage.set(d, i);
    }
  });
  let form;
  try { form = doc.getForm(); } catch { return []; }
  return form.getFields().map((field): FieldDef => {
    const widgets = field.acroField.getWidgets().map((w) => {
      const r = w.getRectangle();
      return { pageIndex: annotPage.get(w.dict) ?? 0, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
    });
    const name = field.getName();
    if (field instanceof PDFTextField) return { name, type: "text", widgets };
    if (field instanceof PDFCheckBox) return { name, type: "checkbox", widgets };
    if (field instanceof PDFRadioGroup) return { name, type: "radio", options: field.getOptions(), widgets };
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) return { name, type: "dropdown", options: field.getOptions(), widgets };
    return { name, type: "unsupported", widgets };
  });
}

/** Rebuild /AcroForm in `out` from the widgets present on the copied pages (spike-proven). Merges with an existing AcroForm's DR. */
export function rebuildAcroForm(out: PDFDocument, src: PDFDocument, copiedPages: PDFPage[]) {
  const fieldRefs: PDFRef[] = [];
  const seen = new Set<string>();
  for (const page of copiedPages) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (const ref of annots.asArray()) {
      if (!(ref instanceof PDFRef)) continue;
      let top: PDFRef = ref; let dict = out.context.lookup(ref) as PDFDict;
      while (dict?.get(PDFName.of("Parent")) instanceof PDFRef) { top = dict.get(PDFName.of("Parent")) as PDFRef; dict = out.context.lookup(top) as PDFDict; }
      if (dict?.has(PDFName.of("FT")) && !seen.has(top.toString())) { seen.add(top.toString()); fieldRefs.push(top); }
    }
  }
  // prune Kids that were not copied (widgets on pages we did not keep)
  const copiedWidgetRefs = new Set(copiedPages.flatMap((p) => p.node.Annots()?.asArray().map(String) ?? []));
  for (const top of fieldRefs) {
    const dict = out.context.lookup(top) as PDFDict;
    const kids = dict.get(PDFName.of("Kids"));
    if (kids instanceof PDFArray) {
      const kept = kids.asArray().filter((k) => copiedWidgetRefs.has(String(k)));
      dict.set(PDFName.of("Kids"), out.context.obj(kept));
    }
  }
  // copyPages is called once per page, so a field shared by several pages is cloned once per page: merge clones by name.
  const fullName = (d: PDFDict): string => {
    const t = d.lookup(PDFName.of("T"));
    const own = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : "";
    const parent = d.get(PDFName.of("Parent"));
    const pd = parent instanceof PDFRef ? out.context.lookup(parent) : undefined;
    const prefix = pd instanceof PDFDict ? fullName(pd) : "";
    return prefix && own ? `${prefix}.${own}` : prefix || own;
  };
  const byName = new Map<string, PDFRef>();
  const merged: PDFRef[] = [];
  for (const top of fieldRefs) {
    const dict = out.context.lookup(top) as PDFDict;
    const name = fullName(dict);
    const first = name ? byName.get(name) : undefined;
    const firstDict = first && (out.context.lookup(first) as PDFDict);
    const firstKids = firstDict?.get(PDFName.of("Kids"));
    const kids = dict.get(PDFName.of("Kids"));
    if (first && firstDict && firstKids instanceof PDFArray && kids instanceof PDFArray) {
      for (const k of kids.asArray()) {
        firstKids.push(k);
        const kd = out.context.lookup(k);
        if (kd instanceof PDFDict) kd.set(PDFName.of("Parent"), first);
      }
      continue;
    }
    if (name && !first) byName.set(name, top);
    merged.push(top);
  }
  fieldRefs.length = 0; fieldRefs.push(...merged);

  const existingRef = out.catalog.get(PDFName.of("AcroForm"));
  const acro = existingRef ? (out.context.lookup(existingRef) as PDFDict) : out.context.obj({});
  acro.set(PDFName.of("Fields"), out.context.obj(fieldRefs));
  const srcAcro = src.catalog.get(PDFName.of("AcroForm")) ? (src.context.lookup(src.catalog.get(PDFName.of("AcroForm"))!) as PDFDict) : undefined;
  if (srcAcro?.get(PDFName.of("DA")) && !acro.get(PDFName.of("DA"))) acro.set(PDFName.of("DA"), srcAcro.get(PDFName.of("DA"))!);
  if (srcAcro?.get(PDFName.of("DR"))) {
    const srcDR = src.context.lookup(srcAcro.get(PDFName.of("DR"))!) as PDFDict;
    const cloned = srcDR.clone(out.context);
    const existingDR = acro.get(PDFName.of("DR")) ? (out.context.lookup(acro.get(PDFName.of("DR"))!) as PDFDict) : undefined;
    if (existingDR) { for (const [k, v] of cloned.entries()) if (!existingDR.has(k)) existingDR.set(k, v); }
    else acro.set(PDFName.of("DR"), out.context.register(cloned));
  }
  if (!existingRef) out.catalog.set(PDFName.of("AcroForm"), out.context.register(acro));
  return { fieldCount: fieldRefs.length };
}

export function applyFormValues(out: PDFDocument, values: Map<string, FormValue>, fields: FieldDef[]) {
  const form = out.getForm();
  const present = new Set(form.getFields().map((f) => f.getName()));
  for (const def of fields) {
    if (!present.has(def.name) || !values.has(def.name)) continue;
    const v = values.get(def.name)!;
    try {
      switch (def.type) {
        case "text": form.getTextField(def.name).setText(String(v)); break;
        case "checkbox": v ? form.getCheckBox(def.name).check() : form.getCheckBox(def.name).uncheck(); break;
        case "radio": if (typeof v === "string" && def.options?.includes(v)) form.getRadioGroup(def.name).select(v); break;
        case "dropdown": { const sel = Array.isArray(v) ? v : [String(v)]; if (sel.every((s) => def.options?.includes(s))) form.getDropdown(def.name).select(sel[0]); break; }
      }
    } catch { /* unsupported or malformed field: leave untouched */ }
  }
}
