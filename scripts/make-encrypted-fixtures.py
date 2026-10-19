#!/usr/bin/env python3
"""Generate small synthetic PDFs encrypted with an EMPTY user password (owner password only).

These model government/bank notices whose owner password only restricts permissions.
Run: python3 scripts/make-encrypted-fixtures.py   (needs: pip install pypdf cryptography  -- cryptography is
pypdf's AES backend; the objstm variant also uses pikepdf, optional)
Output: src/pdf/__fixtures__/encrypted-{rc4-128,aes-128,aes-256}.pdf, plus
        encrypted-userpw-aes-128.pdf (user password "secret") for the password-required path.
Synthetic content only; never commit a real document here.
"""
import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject,
                           NameObject, NumberObject, TextStringObject)

OUT = Path(__file__).resolve().parent.parent / "src/pdf/__fixtures__"
OUT.mkdir(parents=True, exist_ok=True)


def plain_pdf() -> bytes:
    w = PdfWriter()
    for i in range(2):
        page = w.add_blank_page(width=300, height=400)
        font = DictionaryObject({
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        })
        font_ref = w._add_object(font)
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref}),
        })
        content = DecodedStreamObject()
        content.set_data(f"BT /F1 24 Tf 20 360 Td (encrypted:{i}) Tj ET".encode())
        page[NameObject("/Contents")] = w._add_object(content)
    # A text field so the forms path has an encrypted string to read.
    page0 = w.pages[0]
    widget = DictionaryObject({
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/Subtype"): NameObject("/Widget"),
        NameObject("/FT"): NameObject("/Tx"),
        NameObject("/T"): TextStringObject("name"),
        NameObject("/V"): TextStringObject("Alice"),
        NameObject("/Rect"): ArrayObject([FloatObject(20), FloatObject(300), FloatObject(220), FloatObject(324)]),
        NameObject("/F"): NumberObject(4),
        NameObject("/P"): page0.indirect_reference,
    })
    widget_ref = w._add_object(widget)
    page0[NameObject("/Annots")] = ArrayObject([widget_ref])
    w._root_object[NameObject("/AcroForm")] = DictionaryObject({NameObject("/Fields"): ArrayObject([widget_ref])})
    w.add_metadata({"/Title": "Encrypted fixture"})
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def encrypt(plain: bytes, name: str, algorithm: str, user_password: str = "") -> None:
    w = PdfWriter(clone_from=PdfReader(io.BytesIO(plain)))
    w.encrypt(user_password=user_password, owner_password="owner", algorithm=algorithm)
    path = OUT / f"{name}.pdf"
    with open(path, "wb") as f:
        w.write(f)
    print(f"wrote {path.relative_to(OUT.parent.parent.parent)} ({path.stat().st_size} bytes)")


plain = plain_pdf()
encrypt(plain, "encrypted-rc4-128", "RC4-128")
encrypt(plain, "encrypted-aes-128", "AES-128")
encrypt(plain, "encrypted-aes-256", "AES-256")
encrypt(plain, "encrypted-userpw-aes-128", "AES-128", user_password="secret")

# Optional: the same document with its objects packed into object streams (xref stream + /ObjStm),
# which is how most modern writers lay out encrypted files. Needs pikepdf (pip install pikepdf).
try:
    import pikepdf
except ImportError:  # pragma: no cover
    print("pikepdf not installed; skipping encrypted-aes-128-objstm.pdf")
else:
    with pikepdf.open(io.BytesIO(plain)) as pdf:
        path = OUT / "encrypted-aes-128-objstm.pdf"
        pdf.save(path, encryption=pikepdf.Encryption(user="", owner="owner", R=4, aes=True),
                 object_stream_mode=pikepdf.ObjectStreamMode.generate)
        print(f"wrote {path.relative_to(OUT.parent.parent.parent)} ({path.stat().st_size} bytes)")
