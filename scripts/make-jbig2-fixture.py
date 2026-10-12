#!/usr/bin/env python3
"""Build src/test/fixtures/jbig2.pdf: a text-free scanned page whose image is a JBIG2 (MMR generic region) stream.

Same geometry/text as scan.pdf (see makeScan in make-fixtures.ts). Needs Pillow (libtiff) and PyMuPDF.
"""
import io
import struct
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "src/test/fixtures"
W, H = round(300 * 200 / 72), round(400 * 200 / 72)  # 833 x 1111
FONT_DIRS = ["/System/Library/Fonts/Supplemental/", "/Library/Fonts/", "/usr/share/fonts/truetype/dejavu/"]


def font(names, size):
    for d in FONT_DIRS:
        for n in names:
            if Path(d, n).exists():
                return ImageFont.truetype(d + n, size)
    return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size)


def render_text() -> Image.Image:
    img = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(img)
    bold, reg = font(["Arial Bold.ttf", "DejaVuSans-Bold.ttf"], 48), font(["Arial.ttf", "DejaVuSans.ttf"], 40)
    d.text((60, 120), "Patient: Jane Example", fill=0, font=bold, anchor="ls")
    d.text((60, 220), "Diagnosis: hypertension", fill=0, font=reg, anchor="ls")
    d.text((60, 300), "Medication: lisinopril 10 mg", fill=0, font=reg, anchor="ls")
    return img.point(lambda v: 255 if v > 127 else 0).convert("1")


def g4_strip(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="TIFF", compression="group4", tiffinfo={278: img.height})
    buf.seek(0)
    tif = Image.open(buf)
    offsets, counts = tif.tag_v2[273], tif.tag_v2[279]
    assert len(offsets) == 1 and len(counts) == 1, f"expected one strip, got {len(offsets)}"
    return buf.getvalue()[offsets[0]:offsets[0] + counts[0]]


def segment(num: int, typ: int, data: bytes) -> bytes:
    return struct.pack(">IBBBI", num, typ, 0x00, 1, len(data)) + data


def jbig2_stream(mmr: bytes) -> bytes:
    page_info = struct.pack(">IIIIBH", W, H, 0, 0, 0x00, 0)
    region = struct.pack(">IIIIB", W, H, 0, 0, 0) + b"\x01" + mmr
    return segment(0, 48, page_info) + segment(1, 38, region)


def build_pdf(stream: bytes) -> bytes:
    content = b"q 300 0 0 400 0 0 cm /Im0 Do Q"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        (b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 1 "
         b"/Filter /JBIG2Decode /Length %d >>\nstream\n" % (W, H, len(stream))) + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def dark_fraction(pdf: bytes) -> float:
    pix = fitz.open(stream=pdf, filetype="pdf")[0].get_pixmap(colorspace=fitz.csGRAY)
    s = pix.samples
    return sum(1 for b in s if b < 128) / len(s)


def main():
    img = render_text()
    for attempt, candidate in (("as-is", img), ("inverted", img.point(lambda v: 255 - v))):
        pdf = build_pdf(jbig2_stream(g4_strip(candidate)))
        frac = dark_fraction(pdf)
        print(f"{attempt}: PyMuPDF dark fraction = {frac:.4f}")
        if 0.005 < frac < 0.25:
            OUT.mkdir(parents=True, exist_ok=True)
            (OUT / "jbig2.pdf").write_bytes(pdf)
            img.convert("L").save(OUT / "jbig2.png")
            print(f"wrote {OUT / 'jbig2.pdf'} ({len(pdf)} bytes) and jbig2.png; dark fraction {frac:.4f}")
            return
    sys.exit(f"FAILED: JBIG2 decode did not yield a sane dark fraction (last {frac:.4f})")


main()
