import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument, type PDFObject } from "pdf-lib";

/**
 * Deletes every indirect object not reachable from the catalog or the Info dictionary, and returns how many.
 * Flattening replaces a page's content but leaves its old resources (scan images, Form XObjects) registered in the file;
 * this makes them unrecoverable. Everything reachable (AcroForm /DR fonts, widget /AP streams, ...) is kept.
 */
export function sweepUnreachable(doc: PDFDocument): number {
  const { context } = doc;
  const seen = new Set<string>();
  const stack: PDFObject[] = [context.trailerInfo.Root ?? doc.catalog]; // the Root ref, so the catalog object itself is kept
  const info = context.trailerInfo.Info;
  if (info) stack.push(info);
  while (stack.length) {
    const v = stack.pop()!;
    if (v instanceof PDFRef) {
      if (seen.has(v.tag)) continue;
      seen.add(v.tag);
      const target = context.lookup(v);
      if (target) stack.push(target);
    } else if (v instanceof PDFStream) {
      stack.push(v.dict);
    } else if (v instanceof PDFDict) {
      for (const [, val] of v.entries()) stack.push(val);
    } else if (v instanceof PDFArray) {
      for (let i = 0; i < v.size(); i++) stack.push(v.get(i));
    }
  }
  let deleted = 0;
  for (const [ref] of [...context.enumerateIndirectObjects()]) {
    if (!seen.has(ref.tag)) { context.delete(ref); deleted++; }
  }
  return deleted;
}
