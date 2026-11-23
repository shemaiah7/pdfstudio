import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from "pdf-lib";

export interface RepairResult { bytes: Uint8Array; repaired: boolean; missing: number }

const TYPE = PDFName.of("Type");
const PAGE = PDFName.of("Page");
const PAGES = PDFName.of("Pages");
const KIDS = PDFName.of("Kids");

/** True when every /Kids entry under `node` resolves to a page or a pages node. */
function treeIsIntact(doc: PDFDocument, node: PDFDict, seen: Set<PDFDict>): boolean {
  if (seen.has(node)) return false; // cycle
  seen.add(node);
  const kids = node.lookup(KIDS);
  if (!(kids instanceof PDFArray)) return false;
  for (let i = 0; i < kids.size(); i++) {
    const raw = kids.get(i);
    const kid = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
    if (!(kid instanceof PDFDict)) return false;
    const type = kid.lookup(TYPE);
    if (type === PAGES) {
      if (!treeIsIntact(doc, kid, seen)) return false;
    } else if (type !== PAGE) {
      return false;
    }
  }
  return true;
}

/**
 * Some files declare more pages than they contain (an interrupted download, a truncated copy): the page tree
 * points at objects that are gone, and pdf.js stops at the first one. When that happens, copy the pages pdf-lib
 * can still find into a fresh document. Healthy files are returned untouched.
 */
export async function repairIfDamaged(bytes: Uint8Array): Promise<RepairResult> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const found = src.getPageCount();
  const root = src.catalog.lookup(PAGES);
  let declared = found;
  let damaged = true;
  if (root instanceof PDFDict) {
    const count = root.lookup(PDFName.of("Count"));
    if (count instanceof PDFNumber) declared = count.asNumber();
    // A wrong /Count on an intact tree is harmless (pdf-lib's count drives the page entries); rebuilding would drop forms and outlines.
    damaged = !treeIsIntact(src, root, new Set());
  }
  if (!damaged) return { bytes, repaired: false, missing: 0 };
  if (found === 0) throw new Error("No readable pages");
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, src.getPageIndices());
  for (const p of copied) out.addPage(p);
  return { bytes: await out.save(), repaired: true, missing: Math.max(0, declared - found) };
}
