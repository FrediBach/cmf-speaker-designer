#!/usr/bin/env python3
"""Generate the offline outline fonts used by multicolor text shapes.

Requires Python 3.9+, fonttools==4.59.2, skia-pathops==0.8.0.post2
(build-time only).
Run: python3 scripts/generate-pattern-fonts.py --source-dir /tmp/pattern-fonts
Missing upstream files are downloaded into --source-dir, never into the repo.
The three original regular faces and the two upstream bold faces are untouched.
"""

import argparse
import base64
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request
import zlib

import pathops
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
COMMIT = "1d0e46c7933245c8180fe83e47917961c913bbdb"
BASE = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl"
WEIGHTS = (300, 400, 500, 600, 700, 800)
FAMILIES = (
    ("inter", "Inter", "inter", "Inter[opsz,wght].ttf", WEIGHTS),
    ("roboto", "Roboto", "roboto", "Roboto[wdth,wght].ttf", WEIGHTS),
    ("montserrat", "Montserrat", "montserrat", "Montserrat[wght].ttf", WEIGHTS),
    ("dm-sans", "DM Sans", "dmsans", "DMSans[opsz,wght].ttf", WEIGHTS),
    ("oswald", "Oswald", "oswald", "Oswald[wght].ttf", (300, 400, 500, 600, 700)),
    ("lato", "Lato", "lato", {300: "Lato-Light.ttf", 400: "Lato-Regular.ttf", 700: "Lato-Bold.ttf"}, (300, 400, 700)),
    ("merriweather", "Merriweather", "merriweather", "Merriweather[opsz,wdth,wght].ttf", WEIGHTS),
    ("playfair-display", "Playfair Display", "playfairdisplay", "PlayfairDisplay[wght].ttf", (400, 500, 600, 700, 800)),
    ("space-mono", "Space Mono", "spacemono", {400: "SpaceMono-Regular.ttf", 700: "SpaceMono-Bold.ttf"}, (400, 700)),
)

# Printable ASCII, Latin-1, common additional European letters and punctuation.
# Keep the repertoire identical across weights; unsupported glyphs are omitted
# rather than silently replaced, so runtime validation can explain what is absent.
CHARACTERS = sorted(set(
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) +
    [ord(c) for c in "ŒœŠšŸŽžẞ–—‘’‚“”„•…‹›€™"]
))


class TypefacePen(BasePen):
    """Preserve native curves and winding while decomposing composite glyphs."""

    def __init__(self, glyph_set, scale):
        super().__init__(glyph_set)
        self.scale = scale
        self.tokens = []
        self.start = None
        self.last = None

    def point(self, point):
        # A 1000-unit em at integer precision is enough for the editor's mm
        # scale and bounds the file size without flattening Bezier curves.
        return tuple(int(round(v * self.scale)) for v in point)

    def emit(self, command, *points):
        self.tokens.append(command)
        for point in points:
            self.tokens.extend(str(value) for value in self.point(point))
        self.last = self.point(points[0])

    def _moveTo(self, point):
        self.start = self.point(point)
        self.emit("m", point)

    def _lineTo(self, point):
        self.emit("l", point)

    def _qCurveToOne(self, control, end):
        # FontLoader's typeface format stores the endpoint before controls.
        self.emit("q", end, control)

    def _curveToOne(self, control1, control2, end):
        self.emit("b", end, control1, control2)

    def _closePath(self):
        # FontLoader ignores SVG's z command, so explicitly close the contour.
        if self.last != self.start:
            self.tokens.extend(["l", str(self.start[0]), str(self.start[1])])
        self.start = self.last = None

    def _endPath(self):
        self._closePath()


def source_file(directory, upstream, filename):
    path = directory / (f"{upstream}-OFL.txt" if filename == "OFL.txt" else filename)
    url = f"{BASE}/{upstream}/{urllib.parse.quote(filename)}"
    if not path.exists():
        print(f"Downloading {upstream}/{filename}")
        urllib.request.urlretrieve(url, path)
    return path, url


def outlines(path, source_url, display_name, family_index, weight, copyright_notice):
    font = TTFont(path)
    location = {}
    if "fvar" in font:
        location = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
        location["wght"] = weight
        weight_axis = next(axis for axis in font["fvar"].axes if axis.axisTag == "wght")
        if not weight_axis.minValue <= weight <= weight_axis.maxValue:
            raise ValueError(f"{display_name} does not support weight {weight}")
    elif font["OS/2"].usWeightClass != weight:
        raise ValueError(f"{path.name} is not a true weight {weight} face")

    # FontTools evaluates both gvar outlines and HVAR advances at this exact
    # location. This uses the designed masters, never a synthetic stroke.
    glyph_set = font.getGlyphSet(location=location)
    cmap = font.getBestCmap()
    scale = 1000 / font["head"].unitsPerEm
    glyphs = {}
    bounds = []
    for codepoint in CHARACTERS:
        glyph_name = cmap.get(codepoint)
        if glyph_name is None:
            continue
        glyph = glyph_set[glyph_name]
        # Variable font masters may intentionally overlap, or use a single
        # self-intersecting contour for multiple counters (e.g. Roboto and
        # Montserrat B). Resolve nonzero fill before FontLoader classifies
        # simple contours; keep the original curves instead of flattening.
        source_path = pathops.Path()
        glyph.draw(source_path.getPen(glyph_set))
        clean_path = pathops.simplify(source_path, clockwise=True)
        pen = TypefacePen(glyph_set, scale)
        clean_path.draw(pen)
        bound_pen = BoundsPen(glyph_set)
        clean_path.draw(bound_pen)
        box = [int(round(value * scale)) for value in bound_pen.bounds] if bound_pen.bounds else [0, 0, 0, 0]
        if bound_pen.bounds:
            bounds.append(box)
        glyphs[chr(codepoint)] = {
            "ha": int(round(glyph.width * scale)),
            "x_min": box[0],
            "x_max": box[2],
            "o": " ".join(pen.tokens),
        }

    data = {
        "glyphs": glyphs,
        # Neutral names respect upstream Reserved Font Names after subsetting.
        # Source attribution is retained below; these are internal derivatives.
        "familyName": f"CMF Text {family_index:02d}",
        "cssFontWeight": str(weight),
        "cssFontStyle": "normal",
        "ascender": int(round(font["hhea"].ascent * scale)),
        "descender": int(round(font["hhea"].descent * scale)),
        "underlinePosition": int(round(font["post"].underlinePosition * scale)),
        "underlineThickness": int(round(font["post"].underlineThickness * scale)),
        "boundingBox": {
            "xMin": min(box[0] for box in bounds),
            "yMin": min(box[1] for box in bounds),
            "xMax": max(box[2] for box in bounds),
            "yMax": max(box[3] for box in bounds),
        },
        "resolution": 1000,
        "original_font_information": {
            "sourceFamily": display_name,
            "copyright": copyright_notice,
            "license": "SIL Open Font License 1.1; see /licenses/multicolor-fonts.txt",
            "source": source_url,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "modifications": "Subset, overlapping contours resolved with nonzero fill, and converted to Three.js typeface JSON by scripts/generate-pattern-fonts.py; variable axes evaluated at the requested weight and other axes at upstream defaults.",
        },
    }
    font.close()
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--family", choices=[family[0] for family in FAMILIES])
    args = parser.parse_args()
    args.source_dir.mkdir(parents=True, exist_ok=True)
    for index, (font_id, name, upstream, files, weights) in enumerate(FAMILIES, start=1):
        if args.family and args.family != font_id:
            continue
        license_path, _ = source_file(args.source_dir, upstream, "OFL.txt")
        license_text = license_path.read_text()
        copyright_notice = license_text.split("\n\n", 1)[0].strip()
        family = {}
        for weight in weights:
            filename = files[weight] if isinstance(files, dict) else files
            path, url = source_file(args.source_dir, upstream, filename)
            data = outlines(path, url, name, index, weight, copyright_notice)
            raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
            family[str(weight)] = base64.b64encode(zlib.compress(raw, level=9)).decode()
        destination = ROOT / "src/assets/fonts" / f"{font_id}.typefaces.json"
        destination.write_text(json.dumps(family, separators=(",", ":")) + "\n")
        (ROOT / "src/assets/fonts" / f"{font_id}-OFL.txt").write_text(license_text)
        print(f"{destination.name}: {destination.stat().st_size:,} bytes, {len(weights)} weights, {len(data['glyphs'])} glyphs")

    assets = ROOT / "src/assets/fonts"
    notices = [
        (assets / "README.txt").read_text(),
        "\nHelvetiker and Optimer license\n\n" + (assets / "LICENSE.txt").read_text(),
        "\nDroid Sans Mono license\n\n" + (assets / "DROID-NOTICE.txt").read_text(),
    ]
    for font_id, name, upstream, _, _ in FAMILIES:
        license_path, _ = source_file(args.source_dir, upstream, "OFL.txt")
        notices.append(f"\n{name} source font license ({font_id})\n\n" + license_path.read_text())
    combined_notice = "\n".join(line.rstrip() for line in "\n".join(notices).splitlines()) + "\n"
    (ROOT / "public/licenses/multicolor-fonts.txt").write_text(combined_notice)


if __name__ == "__main__":
    main()
