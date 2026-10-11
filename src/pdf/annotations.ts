import { PDFDocument, PDFPage, PDFName, PDFDict, PDFHexString, PDFFont, PDFRef } from "pdf-lib";
import type { Annotation, RGB } from "./types";
import { layoutInBoxes } from "./layout";
import { toWinAnsi } from "./winansi";

export function pdfString(s: string): PDFHexString { return PDFHexString.fromText(s); }

export function isDegenerate(a: Annotation): boolean {
  switch (a.kind) {
    case "highlight": return a.boxes.length === 0 || a.boxes.every((b) => b.width <= 0 || b.height <= 0);
    case "ink": return a.strokes.every((s) => s.length < 2);
    case "shape": return Math.abs(a.x2 - a.x1) < 0.01 && Math.abs(a.y2 - a.y1) < 0.01;
    case "freetext": return a.box.width <= 0 || a.box.height <= 0 || a.text.trim() === "";
    case "signature": return a.box.width <= 0 || a.box.height <= 0 || !a.png.startsWith("data:image/");
    case "note": return false;
  }
}

const f = (n: number) => Number(n.toFixed(3));
const clamp01 = (n: number) => (Number.isNaN(n) ? 0 : Math.min(1, Math.max(0, n)));
const clampRGB = (c: RGB): RGB => [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
const rgbOps = (c: RGB, op: "RG" | "rg") => { const k = clampRGB(c); return `${f(k[0])} ${f(k[1])} ${f(k[2])} ${op}`; };

function appearance(out: PDFDocument, bbox: [number, number, number, number], content: string, resources: Record<string, unknown> = {}): PDFRef {
  const stream = out.context.stream(content, { Type: "XObject", Subtype: "Form", FormType: 1, BBox: bbox, Resources: resources } as any);
  return out.context.register(stream);
}

function addAnnot(out: PDFDocument, page: PDFPage, dict: Record<string, unknown>): PDFRef {
  const ref = out.context.register(out.context.obj({ Type: "Annot", F: 4, ...dict }));
  page.node.addAnnot(ref);
  return ref;
}

export async function writeAnnotations(out: PDFDocument, page: PDFPage, annotations: Annotation[], offset: { x: number; y: number }, fonts: { helv: PDFFont }): Promise<void> {
  const ox = offset.x, oy = offset.y;
  for (const a of annotations) {
    if (isDegenerate(a)) continue;
    switch (a.kind) {
      case "highlight": {
        const boxes = a.boxes.filter((b) => b.width > 0 && b.height > 0);
        if (!boxes.length) break;
        const quads: number[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let content = "/GS gs " + rgbOps(a.color, "rg") + " ";
        for (const b of boxes) {
          const x1 = b.x + ox, y1 = b.y + oy, x2 = x1 + b.width, y2 = y1 + b.height;
          quads.push(x1, y2, x2, y2, x1, y1, x2, y1);
          minX = Math.min(minX, x1); minY = Math.min(minY, y1); maxX = Math.max(maxX, x2); maxY = Math.max(maxY, y2);
          content += `${f(x1)} ${f(y1)} ${f(b.width)} ${f(b.height)} re f `;
        }
        const gs = out.context.register(out.context.obj({ Type: "ExtGState", BM: "Multiply", CA: 1, ca: 1 }));
        const ap = appearance(out, [minX, minY, maxX, maxY], content, { ExtGState: { GS: gs } });
        addAnnot(out, page, { Subtype: "Highlight", Rect: [minX, minY, maxX, maxY], QuadPoints: quads, C: clampRGB(a.color), CA: 1, AP: { N: ap } });
        break;
      }
      case "note": {
        const x = a.x + ox, y = a.y + oy, s = 20;
        const content = `${rgbOps(a.color, "rg")} ${f(x)} ${f(y)} ${s} ${s} re f 1 1 1 rg ${f(x + 4)} ${f(y + 6)} ${s - 8} 3 re f ${f(x + 4)} ${f(y + 11)} ${s - 8} 3 re f`;
        const ap = appearance(out, [x, y, x + s, y + s], content);
        const textRef = out.context.nextRef();
        const popupRef = out.context.register(out.context.obj({ Type: "Annot", Subtype: "Popup", Rect: [x + s, y - 60, x + s + 180, y + s], Parent: textRef, Open: false }));
        out.context.assign(textRef, out.context.obj({ Type: "Annot", Subtype: "Text", F: 4, Rect: [x, y, x + s, y + s], Name: "Comment", Contents: pdfString(a.text), C: clampRGB(a.color), Popup: popupRef, AP: { N: ap } }));
        page.node.addAnnot(textRef);
        page.node.addAnnot(popupRef);
        break;
      }
      case "ink": {
        const inkList = a.strokes.filter((s) => s.length >= 2).map((s) => s.flatMap((p) => [f(p.x + ox), f(p.y + oy)]));
        const xs = inkList.flatMap((l) => l.filter((_, i) => i % 2 === 0)), ys = inkList.flatMap((l) => l.filter((_, i) => i % 2 === 1));
        const pad = a.width;
        const rect: [number, number, number, number] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
        let content = `${rgbOps(a.color, "RG")} ${f(a.width)} w 1 J 1 j `;
        for (const l of inkList) { content += `${l[0]} ${l[1]} m `; for (let i = 2; i < l.length; i += 2) content += `${l[i]} ${l[i + 1]} l `; content += "S "; }
        const ap = appearance(out, rect, content);
        addAnnot(out, page, { Subtype: "Ink", Rect: rect, InkList: inkList, C: clampRGB(a.color), BS: { W: a.width }, AP: { N: ap } });
        break;
      }
      case "shape": {
        const x1 = a.x1 + ox, y1 = a.y1 + oy, x2 = a.x2 + ox, y2 = a.y2 + oy, w = a.width, pad = w * 4 + 2;
        const rect: [number, number, number, number] = [Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad];
        if (a.shape === "rect") {
          // Square annotations: Rect is the shape's own bounds; the border is drawn inset so it stays inside the BBox.
          const sq: [number, number, number, number] = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
          const content = `${rgbOps(a.color, "RG")} ${f(w)} w ${f(sq[0] + w / 2)} ${f(sq[1] + w / 2)} ${f(sq[2] - sq[0] - w)} ${f(sq[3] - sq[1] - w)} re S`;
          addAnnot(out, page, { Subtype: "Square", Rect: sq, C: clampRGB(a.color), BS: { W: w }, AP: { N: appearance(out, sq, content) } });
        } else {
          const ang = Math.atan2(y2 - y1, x2 - x1), hl = 6 + w * 2;
          const hx1 = x2 - hl * Math.cos(ang - Math.PI / 6), hy1 = y2 - hl * Math.sin(ang - Math.PI / 6);
          const hx2 = x2 - hl * Math.cos(ang + Math.PI / 6), hy2 = y2 - hl * Math.sin(ang + Math.PI / 6);
          const content = `${rgbOps(a.color, "RG")} ${f(w)} w 1 J 1 j ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S ${f(hx1)} ${f(hy1)} m ${f(x2)} ${f(y2)} l ${f(hx2)} ${f(hy2)} l S`;
          addAnnot(out, page, { Subtype: "Line", Rect: rect, L: [x1, y1, x2, y2], LE: ["None", "OpenArrow"], C: clampRGB(a.color), BS: { W: w }, AP: { N: appearance(out, rect, content) } });
        }
        break;
      }
      case "freetext": {
        const b = a.box, x = b.x + ox, y = b.y + oy;
        const measure = (t: string, s: number) => fonts.helv.widthOfTextAtSize(toWinAnsi(t), s);
        const { lines, fontSize } = layoutInBoxes(a.text, [{ x: x + 2, y, width: b.width - 4, height: b.height }], a.fontSize, measure, { keepOverflow: true });
        let content = `/Tx BMC q ${f(x)} ${f(y)} ${f(b.width)} ${f(b.height)} re W n BT /Helv ${f(fontSize)} Tf ${rgbOps(a.color, "rg")} `;
        for (const l of lines) content += `1 0 0 1 ${f(l.x)} ${f(l.baseline)} Tm ${fonts.helv.encodeText(toWinAnsi(l.text)).toString()} Tj `;
        content += "ET Q EMC";
        const ap = appearance(out, [x, y, x + b.width, y + b.height], content, { Font: { Helv: fonts.helv.ref } });
        addAnnot(out, page, { Subtype: "FreeText", Rect: [x, y, x + b.width, y + b.height], Contents: pdfString(a.text), DA: `/Helv ${f(a.fontSize)} Tf ${rgbOps(a.color, "rg")}`, C: [1, 1, 1], AP: { N: ap } });
        break;
      }
      case "signature": {
        const bytes = Uint8Array.from(atob(a.png.split(",")[1]), (c) => c.charCodeAt(0));
        const img = a.png.startsWith("data:image/jpeg") || a.png.startsWith("data:image/jpg") ? await out.embedJpg(bytes) : await out.embedPng(bytes);
        page.drawImage(img, { x: a.box.x + ox, y: a.box.y + oy, width: a.box.width, height: a.box.height });
        break;
      }
    }
  }
}


export function ensureAcroFormDR(out: PDFDocument, helv: PDFFont) {
  const existing = out.catalog.get(PDFName.of("AcroForm"));
  const acro = existing ? (out.context.lookup(existing) as PDFDict) : out.context.obj({ Fields: [] });
  const dr = (acro.get(PDFName.of("DR")) && out.context.lookup(acro.get(PDFName.of("DR"))!)) as PDFDict | undefined;
  const drDict = dr ?? out.context.obj({});
  const fontDict = (drDict.get(PDFName.of("Font")) && out.context.lookup(drDict.get(PDFName.of("Font"))!)) as PDFDict | undefined ?? out.context.obj({});
  fontDict.set(PDFName.of("Helv"), helv.ref);
  drDict.set(PDFName.of("Font"), fontDict);
  acro.set(PDFName.of("DR"), drDict);
  if (!existing) out.catalog.set(PDFName.of("AcroForm"), out.context.register(acro));
}
