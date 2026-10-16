Multicolor text fonts

These local outline assets keep multicolor text available offline and
identical in the editor, geometry worker, and print exports.

Original Three.js fonts
----------------------

The five unmodified *.typeface.json files are bundled from Three.js r186.
The original three regular files remain byte-for-byte unchanged so existing
saved designs keep their previous outlines.

Source: https://github.com/mrdoob/three.js/tree/r186/examples/fonts

helvetiker_regular.typeface.json, helvetiker_bold.typeface.json,
optimer_regular.typeface.json, and optimer_bold.typeface.json:
Copyright (c) 2004 MAGENTA Ltd. See LICENSE.txt and the font metadata for
the full permission notice.

droid_sans_mono_regular.typeface.json:
Copyright (c) 2006 Google Corporation. Distributed in Three.js under the
Apache License, Version 2.0. See DROID-README.txt and DROID-NOTICE.txt from
the upstream droid directory. The original font metadata is retained.

Additional Google Fonts outlines
-------------------------------

The nine *.typefaces.json collections contain derived, subset outlines from
Inter, Roboto, Montserrat, DM Sans, Oswald, Lato, Merriweather, Playfair
Display, and Space Mono. Each collection maps a numeric weight string to
base64-encoded, zlib-compressed UTF-8 Three.js typeface JSON. The runtime
expands only the requested face; no network requests or additional runtime
dependencies are needed.

Source: https://github.com/google/fonts/tree/1d0e46c7933245c8180fe83e47917961c913bbdb/ofl
License: SIL Open Font License 1.1; each family's full notice is retained in
<font-id>-OFL.txt and in the distributed combined notice.

All weights use the actual static face or variable font master interpolation;
no synthetic bolding is applied. Non-weight axes keep their upstream defaults.
The subset contains printable ASCII, Latin-1, additional European letters
(OE ligature, S/Z carons, Y diaeresis, capital sharp S), and common punctuation
where the source provides them. Unsupported characters are rejected by the
editor rather than silently replaced. The script is the exact repertoire.

The conversion resolves overlapping and self-intersecting contours using
nonzero fill before retaining native quadratic/cubic curves. Coordinates are
quantized to integer units in a 1000-unit em. Derived internal family names
are CMF Text 01 through CMF Text 09 to respect Reserved Font Names; original
family names, copyright notices, source URLs, SHA-256 hashes, and conversion
details are retained inside each compressed face.

Rebuild with Python 3.9+ and these build-time-only dependencies:
  python3 -m pip install fonttools==4.59.2 skia-pathops==0.8.0.post2
  python3 scripts/generate-pattern-fonts.py --source-dir /tmp/pattern-fonts

The script downloads pinned sources into the temporary source directory,
regenerates the nine collections and per-family licenses, and refreshes the
combined notice. It never modifies the original three regular fonts or the
two upstream bold fonts. --family <id> regenerates one collection.

A combined notice is distributed with the built app at
public/licenses/multicolor-fonts.txt.

Picker names for the reserved-name derivatives are CMF Humanist (Lato),
CMF Book Serif (Merriweather), and CMF Editorial Serif (Playfair Display).
The source-family names are attribution, not the names of these derivatives.
See https://openfontlicense.org/ofl-faq/#5-3 for the font-menu name guidance.
