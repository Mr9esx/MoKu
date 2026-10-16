#!/usr/bin/env python3
"""Check display glyph coverage, or rebuild using the documented original font."""

import argparse
from copy import deepcopy
import hashlib
from pathlib import Path
import re

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/fonts/woodwork-serif-heavy.woff2"


def interface_characters():
    text = "".join(
        path.read_text(encoding="utf-8")
        for path in (ROOT / "src").rglob("*")
        if path.suffix in {".ts", ".tsx", ".css"}
    )
    return {ord(char) for char in text if "\u3400" <= char <= "\u9fff"}


def check(font):
    missing = sorted(interface_characters() - font.getBestCmap().keys())
    if missing:
        raise SystemExit("Missing interface glyphs: " + "".join(map(chr, missing)))
    print(f"All {len(interface_characters())} interface Han characters are covered.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Original Noto Serif SC 900 TTF; omit to check coverage")
    args = parser.parse_args()
    current = TTFont(OUTPUT)
    if args.source:
        font = TTFont(args.source)
        if font["OS/2"].usWeightClass != current["OS/2"].usWeightClass:
            raise SystemExit("Source weight must match the existing 900-weight font.")
        required = set(current.getBestCmap()) | interface_characters() | set(range(32, 127))
        missing = required - font.getBestCmap().keys()
        if missing:
            raise SystemExit("Source font lacks required glyphs: " + "".join(map(chr, sorted(missing))))
        options = subset.Options()
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=required)
        subsetter.subset(font)
        # Keep the renamed family and its existing attribution/license records.
        font["name"] = deepcopy(current["name"])
        font.flavor = "woff2"
        font.recalcTimestamp = False
        font.save(OUTPUT)
        current = TTFont(OUTPUT)
        # Refresh cached fonts and keep the preload URL identical to @font-face.
        version = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()[:12]
        for path in (ROOT / "src/styles.css", ROOT / "index.html"):
            text = path.read_text(encoding="utf-8")
            path.write_text(re.sub(
                r"/fonts/woodwork-serif-heavy\.woff2(?:\?v=[0-9a-f]+)?",
                f"/fonts/woodwork-serif-heavy.woff2?v={version}", text,
            ), encoding="utf-8")
    check(current)


if __name__ == "__main__":
    main()
