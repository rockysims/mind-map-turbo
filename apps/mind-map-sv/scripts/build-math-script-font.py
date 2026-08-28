#!/usr/bin/env python3
"""Build the script-capital math font we redistribute, straight from KaTeX.

Temml ships its own clone of KaTeX_Script-Regular (`temml/dist/Temml.woff2`).
The glyphs in it are fine, but its name table was overwritten by the tool that
built it and now advertises

    This font is made with the home edition of FontCreator.
    You may not use this font for commercial purposes.

in place of the SIL Open Font License the glyphs are actually under. Because our
production build inlines that binary into `index.html` as a data URI, we would
be the ones redistributing that claim. So we generate our own copy from KaTeX's
original, which carries the correct OFL notice, and ship that instead.

The output is committed to the repo. Re-run this only when KaTeX's font changes
or the metadata below does:

    python3 -m venv /tmp/fontbuild
    /tmp/fontbuild/bin/pip install 'fonttools[woff]'
    /tmp/fontbuild/bin/python apps/mind-map-sv/scripts/build-math-script-font.py

The source TTF is read from the `katex` npm tarball rather than vendored, so the
provenance of the glyphs stays a single `npm pack` away from being re-verified.
"""

from __future__ import annotations

import argparse
import string
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

KATEX_VERSION = "0.18.4"
SOURCE_FONT = "KaTeX_Script-Regular.ttf"

# KaTeX's OFL notice names KaTeX_Script as a Reserved Font Name, so OFL 1.1 §4
# forbids a derivative from using it. Hence our own family name.
FAMILY_NAME = "MindMapScript"
OUTPUT_NAME = "MindMapScript-Regular.woff2"

# Unicode assigned eight script capitals in the Letterlike Symbols block before
# the Mathematical Alphanumeric Symbols block existed, and left holes in the
# later block rather than duplicating them. A plain offset from U+1D49C would
# land on those holes for these letters.
LETTERLIKE_SUBSTITUTES = {
    "B": 0x212C,  # SCRIPT CAPITAL B
    "E": 0x2130,  # SCRIPT CAPITAL E
    "F": 0x2131,  # SCRIPT CAPITAL F
    "H": 0x210B,  # SCRIPT CAPITAL H
    "I": 0x2110,  # SCRIPT CAPITAL I
    "L": 0x2112,  # SCRIPT CAPITAL L
    "M": 0x2133,  # SCRIPT CAPITAL M
    "R": 0x211B,  # SCRIPT CAPITAL R
}
MATH_SCRIPT_CAPITAL_A = 0x1D49C

COPYRIGHT = (
    "Copyright (c) 2009-2010 Design Science, Inc.\n"
    "Copyright (c) 2014-2018 Khan Academy\n"
    "Copyright (c) 2026 Rocky Sims"
)

LICENSE_DESCRIPTION = (
    "Copyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>)\n"
    "Copyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>),\n"
    "with Reserved Font Name KaTeX_Script.\n"
    "\n"
    "Modifications copyright (c) 2026 Rocky Sims. The outlines are unchanged.\n"
    "The character map was moved from ASCII A-Z to the Unicode Mathematical\n"
    "Alphanumeric Symbols script capitals, and the font was renamed so that it\n"
    "does not use the Reserved Font Name.\n"
    "\n"
    "This Font Software is licensed under the SIL Open Font License, Version 1.1.\n"
    "This license is available with a FAQ at: https://openfontlicense.org"
)
LICENSE_URL = "https://openfontlicense.org"

WINDOWS_UNICODE_BMP = (3, 1, 0x409)


def target_codepoint(letter: str) -> int:
    """Map an ASCII capital to the Unicode script capital that renders it."""
    if letter in LETTERLIKE_SUBSTITUTES:
        return LETTERLIKE_SUBSTITUTES[letter]
    return MATH_SCRIPT_CAPITAL_A + ord(letter) - ord("A")


def fetch_source_font(destination: Path) -> Path:
    """Download the pinned katex tarball and extract the script font from it."""
    subprocess.run(
        ["npm", "pack", f"katex@{KATEX_VERSION}", "--silent"],
        cwd=destination,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    tarballs = list(destination.glob("katex-*.tgz"))
    if len(tarballs) != 1:
        raise SystemExit(f"expected exactly one katex tarball, found {tarballs}")

    member = f"package/dist/fonts/{SOURCE_FONT}"
    with tarfile.open(tarballs[0]) as archive:
        extracted = archive.extractfile(member)
        if extracted is None:
            raise SystemExit(f"{member} missing from {tarballs[0].name}")
        font_path = destination / SOURCE_FONT
        font_path.write_bytes(extracted.read())
    return font_path


def build_cmap(mapping: dict[int, str]) -> newTable:
    """Build a cmap covering both the BMP and the supplementary planes.

    The script capitals live above U+FFFF, which format 4 cannot address, so a
    format 12 subtable is required. Format 4 is kept alongside it because some
    engines still consult it first for the Letterlike Symbols codepoints, and
    each pair is published for both the Unicode and Windows platforms to match
    what other math fonts ship.

    The language field is zero in every subtable. It is not the name table's
    language ID, and a non-zero value here makes Chromium's font sanitiser
    reject the file outright, which surfaces as a bare network error.
    """
    table = newTable("cmap")
    table.tableVersion = 0
    bmp_only = {cp: name for cp, name in mapping.items() if cp <= 0xFFFF}

    subtables = []
    for platform_id, bmp_encoding, full_encoding in ((0, 3, 4), (3, 1, 10)):
        bmp = CmapSubtable.newSubtable(4)
        bmp.platformID, bmp.platEncID, bmp.language = platform_id, bmp_encoding, 0
        bmp.cmap = dict(bmp_only)

        full = CmapSubtable.newSubtable(12)
        full.platformID, full.platEncID, full.language = platform_id, full_encoding, 0
        full.format = 12
        full.reserved = 0
        full.length = 0  # recomputed at compile time
        full.nGroups = 0
        full.cmap = dict(mapping)

        subtables += [bmp, full]

    table.tables = subtables
    return table


def set_names(font: TTFont) -> None:
    """Replace the name table with records that state the real license."""
    records = {
        0: COPYRIGHT,
        1: FAMILY_NAME,
        2: "Regular",
        3: f"{FAMILY_NAME}-Regular; derived from {SOURCE_FONT}",
        4: f"{FAMILY_NAME} Regular",
        5: "Version 1.001",
        6: f"{FAMILY_NAME}-Regular",
        13: LICENSE_DESCRIPTION,
        14: LICENSE_URL,
    }
    name_table = font["name"]
    name_table.names = []
    for name_id, value in records.items():
        name_table.setName(value, name_id, *WINDOWS_UNICODE_BMP)


def build(output_path: Path) -> None:
    with tempfile.TemporaryDirectory() as work_dir:
        source_path = fetch_source_font(Path(work_dir))
        font = TTFont(source_path)

        existing = font.getBestCmap()
        missing = [c for c in string.ascii_uppercase if ord(c) not in existing]
        if missing:
            raise SystemExit(f"{SOURCE_FONT} is missing ASCII letters {missing}")

        mapping = {0x20: "space", 0xA0: "uni00A0"}
        for letter in string.ascii_uppercase:
            mapping[target_codepoint(letter)] = existing[ord(letter)]

        font["cmap"] = build_cmap(mapping)
        set_names(font)

        # OS/2 advertises which Unicode blocks a font covers; leaving KaTeX's
        # Basic Latin claim would misdescribe a font that no longer maps ASCII.
        font["OS/2"].recalcUnicodeRanges(font)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        font.flavor = "woff2"
        font.save(output_path)

    print(f"wrote {output_path} ({output_path.stat().st_size} bytes)")


def main() -> int:
    default_output = (
        Path(__file__).resolve().parent.parent / "src" / "lib" / "fonts" / OUTPUT_NAME
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=default_output)
    build(parser.parse_args().output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
