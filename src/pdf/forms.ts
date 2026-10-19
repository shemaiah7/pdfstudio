import { PDFDocument } from "pdf-lib";
import type { SourceFile, SourceId } from "./types";
import { readFieldsFromDoc, type FieldDef } from "./formFill";
import { sourceReleasers } from "../store/document";

export { readFieldsFromDoc, rebuildAcroForm, applyFormValues } from "./formFill";
export type { FieldType, FieldDef } from "./formFill";

const cache = new Map<SourceId, Promise<FieldDef[]>>();
sourceReleasers.push((id) => cache.delete(id));

export async function readFields(source: SourceFile): Promise<FieldDef[]> {
  let p = cache.get(source.id);
  if (!p) {
    // Source bytes are already decrypted on open by decryptIfNeeded.
    p = PDFDocument.load(source.bytes, { ignoreEncryption: true }).then(readFieldsFromDoc).catch(() => []);
    cache.set(source.id, p);
  }
  return p;
}

export function fieldsOnPage(fields: FieldDef[], pageIndex: number) {
  return fields.filter((f) => f.widgets.some((w) => w.pageIndex === pageIndex));
}
