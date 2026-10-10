import { PDFDocument, degrees } from "pdf-lib";
import type { PageEntry, Rotation, SourceFile, SourceId } from "./types";

export function addRotation(a: Rotation, delta: 90 | -90 | 180): Rotation {
  return (((a + delta) % 360) + 360) % 360 as Rotation;
}

export async function countPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  return doc.getPageCount();
}

export async function buildDocument(
  sources: Map<SourceId, SourceFile>,
  pages: PageEntry[],
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const loaded = new Map<SourceId, PDFDocument>();

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
  }

  return out.save();
}
