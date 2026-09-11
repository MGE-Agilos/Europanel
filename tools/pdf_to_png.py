#!/usr/bin/env python
"""Rasterise les PDF de feuilles Qlik en PNG pour la page du parcours.

Pourquoi cette etape existe : le service de reporting de Qlik Cloud ne rend
une feuille entiere qu'en PDF ou PPTX — le PNG n'est disponible que pour un
objet isole. Or le parcours de demonstration montre l'ecran tel que le
presentateur le verra, donc la feuille entiere. On rend donc en PDF, puis on
rasterise ici.

La marge blanche est retiree. Une feuille Qlik est large (environ 2,1:1) et
la page A4 paysage ne l'est pas (1,41:1) : le rendu « autofit » centre donc
la feuille entre deux bandes blanches. Les garder donnerait des captures ou
un quart de la hauteur ne porte aucune information, et qui ne s'alignent pas
avec les captures prises jusqu'ici dans le navigateur.

Usage : python tools/pdf_to_png.py <dossier-pdf> <dossier-png> [--dpi 150]
"""

import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.exit("PyMuPDF est requis : pip install pymupdf")


# Seuil de « blanc ». Le fond des feuilles n'est pas #ffffff pur apres
# rasterisation (antialiasing, profil couleur du PDF) : comparer a 255 strict
# ne retirerait aucune marge.
WHITE = 250


def content_bbox(pix):
    """Boite englobante des pixels non blancs, ou None si la page est vide."""
    w, h, n = pix.width, pix.height, pix.n
    data = pix.samples

    def row_has_ink(y):
        base = y * pix.stride
        for x in range(0, w, 3):           # un pixel sur trois : 3x plus rapide,
            off = base + x * n             # et une marge se detecte largement
            if (data[off] < WHITE or data[off + 1] < WHITE or data[off + 2] < WHITE):
                return True
        return False

    def col_has_ink(x):
        for y in range(0, h, 3):
            off = y * pix.stride + x * n
            if (data[off] < WHITE or data[off + 1] < WHITE or data[off + 2] < WHITE):
                return True
        return False

    top = next((y for y in range(h) if row_has_ink(y)), None)
    if top is None:
        return None
    bottom = next(y for y in range(h - 1, -1, -1) if row_has_ink(y))
    left = next(x for x in range(w) if col_has_ink(x))
    right = next(x for x in range(w - 1, -1, -1) if col_has_ink(x))
    return left, top, right, bottom


def convert(pdf_path, out_path, dpi):
    doc = fitz.open(pdf_path)
    if doc.page_count == 0:
        raise RuntimeError(f"{pdf_path.name} : PDF sans page")
    # Une feuille Qlik tient sur une page. Si le rendu en produisait
    # plusieurs, la premiere seule serait un choix silencieux et faux.
    if doc.page_count > 1:
        print(f"    ATTENTION : {doc.page_count} pages, seule la premiere est prise")

    pix = doc[0].get_pixmap(dpi=dpi, colorspace=fitz.csRGB)
    box = content_bbox(pix)
    if box is None:
        raise RuntimeError(f"{pdf_path.name} : page entierement blanche")

    left, top, right, bottom = box
    pad = max(2, dpi // 48)                  # un liseré, pour ne pas raser le trait
    clip = fitz.Rect(
        max(0, left - pad) * 72 / dpi,
        max(0, top - pad) * 72 / dpi,
        min(pix.width, right + 1 + pad) * 72 / dpi,
        min(pix.height, bottom + 1 + pad) * 72 / dpi,
    )
    out = doc[0].get_pixmap(dpi=dpi, colorspace=fitz.csRGB, clip=clip)
    out.save(out_path)
    doc.close()
    return out.width, out.height


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    src, dst = Path(argv[0]), Path(argv[1])
    dpi = 150
    if "--dpi" in argv:
        dpi = int(argv[argv.index("--dpi") + 1])

    if not src.is_dir():
        sys.exit(f"dossier source introuvable : {src}")
    dst.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(src.glob("*.pdf"))
    if not pdfs:
        sys.exit(f"aucun PDF dans {src}")

    print(f"== Rasterisation a {dpi} dpi ==")
    failures = []
    for pdf in pdfs:
        out = dst / (pdf.stem + ".png")
        try:
            w, h = convert(pdf, out, dpi)
            size_kb = out.stat().st_size // 1024
            print(f"  {pdf.stem:<14} {w} x {h}  ({size_kb} Ko)")
        except Exception as err:                     # noqa: BLE001
            # Une page ratee n'arrete pas les autres : sur une serie de huit,
            # tout rejouer pour une seule coute plus cher que de la reprendre.
            print(f"  {pdf.stem:<14} ECHEC : {err}")
            failures.append(pdf.stem)

    print(f"\n  {len(pdfs) - len(failures)}/{len(pdfs)} converti(s).")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
