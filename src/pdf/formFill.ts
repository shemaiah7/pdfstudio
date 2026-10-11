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
  if (!doc.catalog.has(PDFName.of("AcroForm"))) return [];
  const acro = doc.context.lookup(doc.catalog.get(PDFName.of("AcroForm"))!);
  if (!(acro instanceof PDFDict) || !(acro.lookup(PDFName.of("Fields")) instanceof PDFArray)) throw new Error("Malformed AcroForm");
  const form = doc.getForm(); // throws on a malformed AcroForm; callers decide how to report
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

/**
 * Rebuild/extend /AcroForm in `out` from the widgets present on the copied pages. Accumulates across calls
 * (one per source): fields are appended to /Fields, DR is merged, and top-level names that collide with
 * fields from an earlier call are renamed "<name> (n)". Returns the rename map (old full name -> new).
 */
export function rebuildAcroForm(out: PDFDocument, src: PDFDocument, copiedPages: PDFPage[]) {
  const N = PDFName.of;
  const copiedWidgetRefs = new Set(copiedPages.flatMap((p) => p.node.Annots()?.asArray().map(String) ?? []));
  const dictOf = (o: unknown) => { const d = o instanceof PDFRef ? out.context.lookup(o) : o; return d instanceof PDFDict ? d : undefined; };

  // roots: top-most ancestors of copied widget annotations
  const roots: PDFRef[] = [];
  const seen = new Set<string>();
  for (const page of copiedPages) {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      if (!(ref instanceof PDFRef)) continue;
      const first = dictOf(ref);
      if (!first || first.get(N("Subtype")) !== N("Widget")) continue;
      let top: PDFRef = ref; let dict = first; let hasFT = dict.has(N("FT"));
      for (let i = 0; i < 64; i++) {
        const parent = dict.get(N("Parent"));
        const pd = parent instanceof PDFRef ? dictOf(parent) : undefined;
        if (!(parent instanceof PDFRef) || !pd) break;
        top = parent; dict = pd; hasFT ||= dict.has(N("FT"));
      }
      if (!hasFT) continue;
      if (!seen.has(top.toString())) { seen.add(top.toString()); roots.push(top); }
    }
  }

  // prune Kids that were not copied; returns whether the node retains any copied widget
  const prune = (ref: PDFRef | PDFDict, depth = 0): boolean => {
    const dict = dictOf(ref);
    if (!dict || depth > 64) return false;
    const kids = dict.get(N("Kids"));
    if (!(kids instanceof PDFArray)) return ref instanceof PDFRef && copiedWidgetRefs.has(ref.toString());
    const kept = kids.asArray().filter((k) => k instanceof PDFRef && (copiedWidgetRefs.has(k.toString()) || prune(k, depth + 1)));
    dict.set(N("Kids"), out.context.obj(kept));
    return kept.length > 0;
  };
  const live = roots.filter((r) => prune(r));

  const fullName = (d: PDFDict, depth = 0): string => {
    const t = d.lookup(N("T"));
    const own = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : "";
    const parent = d.get(N("Parent"));
    const pd = parent instanceof PDFRef && depth < 64 ? dictOf(parent) : undefined;
    const prefix = pd ? fullName(pd, depth + 1) : "";
    return prefix && own ? `${prefix}.${own}` : prefix || own;
  };

  // copyPages is called once per page, so a field shared by several pages is cloned once per page: merge clones by name.
  const ownName = (d: PDFDict) => { const t = d.lookup(N("T")); return t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : ""; };
  // Merge clone `b` into survivor `a` (same fully-qualified name): append leaf kids, recurse into same-/T intermediate kids.
  const mergeInto = (a: PDFRef, b: PDFRef, depth = 0): boolean => {
    const ad = dictOf(a); const bd = dictOf(b);
    const ak = ad?.get(N("Kids")); const bk = bd?.get(N("Kids"));
    if (!ad || !bd || !(ak instanceof PDFArray) || !(bk instanceof PDFArray) || depth > 64) return false;
    for (const k of bk.asArray()) {
      const kd = dictOf(k);
      if (!kd || !(k instanceof PDFRef)) continue;
      const twin = kd.get(N("Kids")) instanceof PDFArray
        ? ak.asArray().find((x): x is PDFRef => x instanceof PDFRef && ownName(dictOf(x) ?? kd) === ownName(kd) && dictOf(x)?.get(N("Kids")) instanceof PDFArray && dictOf(x) !== kd)
        : undefined;
      if (twin && mergeInto(twin, k, depth + 1)) continue;
      ak.push(k);
      kd.set(N("Parent"), a);
    }
    return true;
  };
  const byName = new Map<string, PDFRef>();
  const merged: PDFRef[] = [];
  for (const top of live) {
    const dict = dictOf(top)!;
    const name = fullName(dict);
    const first = name ? byName.get(name) : undefined;
    if (first && mergeInto(first, top)) continue;
    if (name && !first) byName.set(name, top);
    merged.push(top);
  }

  const existingRef = out.catalog.get(N("AcroForm"));
  const acro = existingRef ? (out.context.lookup(existingRef) as PDFDict) : out.context.obj({});
  let fields = acro.lookup(N("Fields"));
  if (!(fields instanceof PDFArray)) { fields = out.context.obj([]) as PDFArray; acro.set(N("Fields"), fields); }
  const fieldsArr = fields as PDFArray;
  const have = new Set(fieldsArr.asArray().map(String));
  const used = new Set(fieldsArr.asArray().map((r) => { const d = dictOf(r); return d ? fullName(d) : ""; }));
  const renames = new Map<string, string>();
  for (const top of merged) {
    if (have.has(top.toString())) continue;
    const dict = dictOf(top)!;
    const name = fullName(dict);
    if (name && used.has(name)) {
      const t = dict.lookup(N("T"));
      const own = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : name;
      let n = 2;
      while (used.has(`${own} (${n})`)) n++;
      const renamed = `${own} (${n})`;
      dict.set(N("T"), PDFHexString.fromText(renamed));
      renames.set(name, renamed);
      used.add(renamed);
    } else if (name) used.add(name);
    fieldsArr.push(top);
    have.add(top.toString());
  }

  const srcAcroRef = src.catalog.get(N("AcroForm"));
  const srcAcro = srcAcroRef ? (src.context.lookup(srcAcroRef) as PDFDict) : undefined;
  if (srcAcro?.get(N("DA")) && !acro.get(N("DA"))) acro.set(N("DA"), srcAcro.get(N("DA"))!);
  if (srcAcro?.get(N("DR"))) {
    const srcDR = src.context.lookup(srcAcro.get(N("DR"))!) as PDFDict;
    const cloned = srcDR.clone(out.context);
    const existingDR = acro.get(N("DR")) ? (out.context.lookup(acro.get(N("DR"))!) as PDFDict) : undefined;
    if (existingDR) { for (const [k, v] of cloned.entries()) if (!existingDR.has(k)) existingDR.set(k, v); }
    else acro.set(N("DR"), out.context.register(cloned));
  }
  if (!existingRef) out.catalog.set(N("AcroForm"), out.context.register(acro));
  return { fieldCount: merged.length, renames };
}

export function applyFormValues(out: PDFDocument, values: Map<string, FormValue>, fields: FieldDef[], renames: Map<string, string> = new Map()) {
  const form = out.getForm();
  const translate = (name: string) => {
    for (const [from, to] of renames) if (name === from || name.startsWith(`${from}.`)) return to + name.slice(from.length);
    return name;
  };
  for (const def of fields) {
    if (!values.has(def.name)) continue;
    const v = values.get(def.name)!;
    try {
      const field = form.getField(translate(def.name));
      const sel = Array.isArray(v) ? v : [String(v)];
      const valid = sel.every((x) => def.options?.includes(x));
      if (field instanceof PDFTextField) field.setText(String(v));
      else if (field instanceof PDFCheckBox) { if (v) field.check(); else field.uncheck(); }
      else if (field instanceof PDFRadioGroup) { if (typeof v === "string" && def.options?.includes(v)) field.select(v); }
      else if (field instanceof PDFDropdown) { if (valid && sel.length) field.select(sel[0]); }
      else if (field instanceof PDFOptionList) { if (valid && sel.length) field.select(sel); }
    } catch { /* missing, unsupported or malformed field: leave untouched */ }
  }
}
