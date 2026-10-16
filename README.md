# CMF Speaker Designer

A browser-based front panel designer for CMF Speaker S and M, built as a proof of concept for **cmfspeakerdesigner.com**. The interface is a compact design workspace with a persistent 3D preview, an independently scrolling inspector, and a fixed export action for printable panels, volume knobs, and power buttons. Its warm grey surfaces, orange accents, fine rules, and dotted technical typography draw on the supplied product photography.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Other commands:

```sh
npm run check    # TypeScript validation
npm run doctor -- --verbose # React Doctor diagnostics
npm test         # Geometry, state, STL, STEP, and 3MF export checks
npm run build    # Production files in dist/
npm run preview  # Serve the production build locally
npm run test:production # Build and run the full browser regression suite
```

React Doctor is installed as a development dependency. Run `npm run doctor -- --verbose`
for a full scan; add `--no-score` to skip the remote score and telemetry. The remaining
warnings concern the geometry hooks' serialized dependency keys. Review those keys
before changing dependencies: settings objects are recreated during color edits,
which should not trigger geometry regeneration. Version
0.9.18 also reports two cleanup errors in `SpeakerPreview` because it mistakes Three.js
`Vector3.sub()` subtraction for a subscription. The camera keyboard listener already
has matching cleanup. These findings remain visible and currently make the scan exit
with a nonzero status.

Browser regression checks use Playwright with a locally installed Google Chrome:

```sh
npm run test:e2e
```

The tests start Vite automatically when needed and cover the WebGL preview, model and style changes, saved colors, keyboard face-depth controls, generated handles, grilles, and halos, actual STL and STP downloads, and a narrow mobile layout. Downloads are inspected independently for closed edges, one connected component, hole topology, clear passages through each opening, protected case attachments, and the projection of an angled halo cover. STEP download checks verify the selected format, millimeter units, part bounds, and ZIP contents. Screenshots, downloaded files, and failure traces are written to the ignored `test-results/` directory. GitHub Actions runs the unit checks and full production browser suite on Node.js 24 for pushes and pull requests, retaining browser artifacts when a run fails.

Multicolor suites add editable preset coverage, JSON/share/history checks, material partition topology, and actual 3MF and aligned STL ZIP inspection. Individual material regions may contain disconnected islands; their assembled union must reproduce the complete panel. Browser coverage includes the canvas, material editing, JSON round trips, and downloads. The implementation's current validation status and outstanding slicer/print checks are recorded in [the multicolor plan](plans/multicolor-extension.md#implementation-status--2026-10-15).

To check the bundled geometry worker and WebAssembly module against a production build:

```sh
npm run build
PLAYWRIGHT_PREVIEW=1 npm run test:e2e -- --grep "generates a"
```

Development tests use port 5174; production-preview tests use port 4179. Development tests reuse an existing server; production tests start an isolated preview and fail if that port is occupied.

## Workspace and accessibility

The preview stays visible while the parameters scroll, including on phones. Model selection, editor tabs, and export stay within reach. Color presets are in the Front panel inspector; printing guidance and source files are available from the header. On exceptionally short screens, the layout allows page scrolling so controls remain reachable.

Use **Present** in the preview (the play icon on phones) to automatically orbit the speaker. Camera height follows a separate cycle, so successive rotations reveal different level and elevated views. **Pause** keeps the current angle; dragging, scrolling, camera keyboard controls, choosing a camera view, or resetting the camera returns to manual control. Presentation starts only when requested and is not saved with the design.

Use **Variations**, beside **Present**, to explore an army of 24 alternatives around your original speaker. The speakers stand in a compact 5×5 formation on a shared floor, with subtle adjustments near the original and larger changes in color and shape farther away. Choose **Rotate** or **Pan**, then drag with a mouse or one finger to move the camera; scroll or pinch to zoom. Arrow keys use the selected camera mode when the preview is focused, and plus/minus zoom. Click a speaker or use **Inspect variation** to examine it; **Look closer** focuses the selected speaker while keeping your viewing angle, and **Fit all** restores the whole field. **New variations** generates another set from your original design. Only **Use variation** applies a change, as one undo step, and returns to the single-speaker preview. **Cancel**, **Escape**, and **Keep original** leave your saved design and history intact. Candidates become selectable as their geometry finishes; existing multicolor artwork is retained while its colors vary. If a new panel shape cannot be safely partitioned into those materials, that candidate retries with your original panel shape and retains its varied colors and knob; the inspector identifies this fallback.

The original speaker has a persistent circle on the ground. A smaller rotating ground ring marks the next variation being generated and disappears when that speaker is ready; it stays still when reduced motion is preferred. Speakers appear without floating labels, and the **Inspect variation** selector provides their names and availability.

Use **Appearance** in the header to choose a light or dark theme and an orange or turquoise interface accent. Preferences are saved locally, independently of the speaker design and its shared URL. Accent colors use the existing app palette (`#f45427` orange, `#13b7b1` turquoise); the official product pages name these colorways but do not publish exact hex specifications.

Controls use larger text and targets, high-contrast selected states, and visible keyboard focus. Use the skip link to reach design controls, arrow keys or Home/End within the editor tabs, and arrow keys on sliders. Focus the 3D preview to rotate with arrow keys or zoom with +/−. Closing a dialog returns focus to its opener. Reduced-motion and forced-color preferences are supported.

**Randomize**, next to **Reset**, replaces all design settings with a fresh combination of colors and geometry. Both actions keep the selected Speaker S or M. Undo design changes with **⌘/Ctrl+Z**; redo with **⌘/Ctrl+Shift+Z** or **Ctrl+Y**. A slider drag or held arrow key is one undo step. Text and number fields keep their native editing shortcuts. History includes up to 100 changes in the current session; reloading starts a new history from the saved design.

**Save design JSON** downloads the authored settings; **Load design JSON** restores them as an undoable edit. Designs also save locally. Multicolor artwork and uploaded SVG cutouts use URL fragments for sharing; existing query-based links remain readable. When a link exceeds 64,000 characters, sharing downloads JSON instead. JSON import accepts up to 2 MB and rejects unsupported or oversized multicolor documents without truncating their artwork. A rejected saved document remains intact until an explicit edit, reset, randomization, or successful import allows saving again.

## What the POC does

Choose **Black** or **Gray** under **Speaker body**, next to the model selection. The adjacent **Speaker grille** swatches offer black, orange, and turquoise for the black body. Gray approximates the white speaker variant and always uses a black grille. Speaker S has side resonators; Speaker M has smooth sides. Panel and knob colors remain independent. Body and grille choices are saved locally, shared in design links, and recorded as `bodyColor` and `bodyGrilleColor` in design JSON. Older designs default to a black grille. The body and its grille are preview context only and are not exported as printable parts.

- Switch between Speaker S and M.
- Choose the original front panel or build a custom panel with parametric halos and grilles.
- Generate a halo around each driver with adjustable outward angle, depth, wall thickness, and an angled cut that can turn the ring into a rain-cover shape.
- Generate round, hexagonal, or slotted grilles with adjustable opening size, material spacing, arrangement, rotation, and thickness.
- Continue the grille pattern onto the surrounding front face as recesses up to 6 mm deep, including through-openings away from case attachments, or raised patterns up to 3 mm high.
- Preview independent front panel, power button, and volume knob colors with a black or gray speaker body in an interactive Three.js scene, including panel-only and exploded views.
- Add up to 2 mm of face depth while retaining the original mounting region and overall face dimensions.
- Extend the front and angled panel edges by up to 1 cm per side, with an independently sized handle.
- Add a 0–0.5 cm panel gap with extended attachment necks and cylindrical rear supports on the front and angled section. The knob and button remain at their original height in recessed openings.
- Optionally split the panel at the start of the angled section and print the front and upper parts separately, with a sliding tongue and rear groove for assembly.
- Generate a custom upper handle: adjust its height, width, rounded corners, top angle, and straight or inward/outward rounded top, then choose a solid face, one to three circular or slotted openings, one to seven rounded slits open at the top, or an uploaded SVG cutout.
- Add LEGO-compatible studs to the custom handle's front face.
- Recess one to three centered vertical race stripes into the panel, with adjustable stripe width and gap. Studs and decorative face patterns leave the stripes clear.
- Compose multicolor stripes, crosses, circles/rings, polygons, imported SVGs, and text with arbitrary colors, editable flag presets, a front-view canvas, and numeric controls.
- Change built-in cutout size, spacing, and position, with dependent dimensions constrained to retain at least 3 mm of material between openings and around their closed edges.
- Keep your current design locally and copy a link to share a configuration.
- Select the supplied ring, bar, and cross volume knobs, or generate fluted, faceted, triangle, arrow, V, and automatically sized text grips.
- Keep the original STL base diameter, collar, and socket fixed; shape the upper grip with height and inward taper.
- Generate straight, spiral, or chevron flutes with adjustable count and depth, or choose the number of faces on a faceted grip.
- Inspect the knob at full size in a dedicated preview, or see it mounted on either speaker.
- Export multipart **3MF**, aligned **STL parts** for multicolor, or combined **STL**/**STP** geometry. Include all parts or select the panel, knob, or power button individually, with authored settings and material mappings in the applicable archive.

The designer starts from each model's original front panel mesh. **Custom** selects an open panel ready to configure in the **Halo** and **Grille** tabs; it does not add either feature automatically. Selecting **Original** removes generated halos and grilles while retaining their parameters for later use. The **Original handle** option retains the source upper section. **Custom handle** removes that upper section above the control deck and joins a newly generated extension to the remaining panel; its cutouts pass through the exported solid. Carry loop, Three dots, Hair, and Solid presets provide starting points. STL has no color or unit metadata: the exported coordinates are intended as millimeters. Choose and confirm the corresponding filament in your slicer. This POC does not include freehand drawing, text embossing, automatic filament-slot assignment, or embedded printer profiles.

In **Handle → Custom handle**, adjust **Top angle** to slope the top edge and choose a **Straight**, **Outwards**, or **Inwards** top shape. Rounded shapes offer a **Curve depth** control. Handle height sets the highest point; angle and curve depth are limited together to retain the shoulder and connecting material. Top settings are retained when changing cutouts or switching to the original handle and support local saving, shared links, ZIP metadata, and undo/redo.

Choose **Top slits** to add rounded cuts down from the top edge for a hair-like silhouette. Adjust the slit count, width, depth, gap, and horizontal position, or start with the **Hair** preset, then slope or curve the top for different hair shapes. Up to seven slits fit within the available width; their rounded bottoms leave a connected band at least 3 mm above the handle's shoulder. Individual slits, holes, and SVG shapes are omitted when the changed top would leave insufficient material around them; the requested settings remain available when the top changes again. The preview and STL/STP exports use the same accepted cutouts, and the export summary reports how many fit.

In **Handle → Custom handle**, enable **LEGO-compatible studs** to add studs on the flat front face. Studs use a nominal 4.8 mm diameter, 1.8 mm height, and 8 mm center spacing, following [Kevin McAleer's dimension reference](https://www.kevsrobots.com/blog/lego.html). The layout skips edges and cutouts, including the angled or curved top, so each stud is omitted individually when its full footprint cannot fit. Each accepted stud is joined to the handle in the preview and STL/STP exports. The setting is saved locally, shared in links, included in the ZIP's `design.json`, and supports undo/redo. Printed fit varies by printer and material; test the fit before printing a complete panel.

In **Handle → Custom handle → SVG**, upload a filled SVG (up to 256 KB) to use its shapes as through-cutouts. Adjust **Cutout width** and **Position**; the design keeps its proportions and fits inside the handle's 3 mm outer border. Internal detail spacing comes from your artwork. Use a stencil with bridges where needed: a cutout that leaves floating islands cannot be exported. Convert text and strokes to filled paths, and export inline styles without images, linked shapes, clipping, or masks. The uploaded geometry is saved locally, included in shared links and the ZIP's `design.json`, and participates in undo/redo. Switching cutout types retains the uploaded artwork; **Remove SVG cutout** clears it.

The **Grille** tab generates a perforated grille over the original driver openings: one on S and both on M. Custom grilles use the original open panel as their base and can be combined with a custom handle, halo, and added face depth. Selecting **Original grille** removes the generated grille; a custom halo can remain active.

**Continue across the face** continues the same pattern seamlessly from the driver through-holes into matching recessed or raised shapes across the front face, including along the driver opening rims. These are real surface geometry in the STL. The outside edges, control deck, and case attachments are preserved. Preview and export share the same generated mesh, and grille dimensions are applied after added face depth so their selected thickness and recess depth stay in millimeters.

**Recess depth** ranges from −3 to 6 mm, independently of grille thickness. Positive values recess the pattern and can cut completely through the panel where there is no case attachment; attachment regions retain at least 0.5 mm of backing. Zero leaves the surrounding face flat. Negative values raise the shapes above the face, like studs, by the absolute depth. Driver openings remain through-holes at every depth.

## Split panel assembly

In **Front panel → Print assembly**, enable **Split front and upper panel** to print the front plate separately from the angled control deck and everything above it. The option is off by default for existing and new designs. **Speaker** view shows the assembled panel; **Exploded** separates the front, upper section, volume knob, and power button. Color regions move with their physical panel piece. Exports provide the two printable panel parts.

The upper part has a sliding tongue that fits down into a recessed groove in the back of the front plate. The reinforced groove stays within the available clearance behind the panel. A small solid area around the joint may back the uppermost grille openings when **Continue across the face** is enabled. Join the parts before mounting the panel to the speaker. The joint is intended to support alignment alongside the existing mounting hooks, but its printed fit and strength still need testing before carrying a speaker by the handle.

Split STL/STP exports provide separate front and upper files in a ZIP, including when **Panel only** is selected. Split 3MF contains two panel print objects. In a split **STL parts** export, import all `panel-front-material` files together as one object, and all `panel-upper-material` files together as a second object. Keep each object's color regions aligned; only the two completed panel objects are printed separately.

The assembly choice is saved locally, included in shared links and design JSON, and supports undo/redo. Design variations preserve it; generating an entirely new random design returns to the default one-piece assembly.

## Multicolor patterns

In **Front panel → Colors**, choose **Multicolor** to reveal the configurator. The existing panel color becomes **Background**; knob and power button colors remain independent. Color mode works with both Original and Custom panel geometry. Switching to Single color hides the pattern without deleting it, and selecting Original panel shape retains the multicolor composition.

Add and independently position stripes/rectangles, crosses with unequal arms, circles/rings, polygons, imported SVGs, and text. Use the front-view canvas to move, rotate, resize, or edit polygon vertices, or use numeric coordinates in millimeters. Layer order determines which material wins at overlaps. Shapes can share named materials; **Make unique** separates an assignment, and explicit material merging combines it. Matching hex colors alone do not merge existing materials.

Choose **SVG** to import filled vector artwork as one material layer. Compound paths retain their holes, overlapping paths combine into one silhouette, and width/height edits preserve proportions. **Replace SVG** updates the artwork within its existing layer. Imports accept SVGs up to 256 KB and 4,096 sampled points; convert strokes and embedded text to filled paths and expand clips, masks, and other effects before importing. Original SVG colors are replaced by the layer’s material.

Choose **Text** to add editable lettering with a font size in millimeters and a choice of 12 families, grouped into sans serif, serif, monospace, and display styles. **Font weight** lists the real weights available for the selected family:

| Font                                               | Available weights                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Inter, Roboto, Montserrat, DM Sans, CMF Book Serif | Light (300), Regular (400), Medium (500), Semi Bold (600), Bold (700), Extra Bold (800) |
| Oswald                                             | Light (300), Regular (400), Medium (500), Semi Bold (600), Bold (700)                   |
| CMF Editorial Serif                                | Regular (400), Medium (500), Semi Bold (600), Bold (700), Extra Bold (800)              |
| CMF Humanist                                       | Light (300), Regular (400), Bold (700)                                                  |
| Helvetiker, Optimer, Space Mono                    | Regular (400), Bold (700)                                                               |
| Droid Sans Mono                                    | Regular (400)                                                                           |

CMF Humanist, CMF Book Serif, and CMF Editorial Serif are outline derivatives of Lato, Merriweather, and Playfair Display, renamed to respect their reserved font names. Attribution and licensing details are in [the font notes](src/assets/fonts/README.txt).

Changing families retains the selected weight when available, or chooses the nearest available weight. Fonts and their outlines are bundled locally, so preview and printing use the same lettering without a network font service. Unsupported characters report an error; the added families cover Latin-1, common additional European letters, and punctuation. Text supports up to 120 characters within the outline complexity limit. Existing saved text without a weight retains its original Regular appearance. SVG and text layers support ordering, duplication, undo, saved design JSON, and the same full-depth material geometry in the 2D canvas, 3D preview, and multicolor exports.

The stripe generator supports equal or weighted widths, direction, count, gaps, and a repeating color sequence. Generated stripes remain individually editable; redistribution changes their layout as an explicit operation. Presets include **France, Italy, Germany, Switzerland, Norway, United Kingdom, Rainbow, and Japan**. Each creates ordinary shapes, including asymmetric UK diagonal arms. Choose panel adaptation or preserved flag proportions; display RGB values approximate flag colors and do not specify filament colors.

Authored artwork keeps its physical dimensions when the speaker model or panel geometry changes. **Fit artwork to current panel** applies a uniform scale, preserving circles; **Reapply chosen preset to panel** regenerates the recipe against the current panel. The artwork frame clips the pattern, with background material outside it. Existing holes remain open: a disc entirely inside a driver opening contributes no printable material.

Color regions extend through the finished panel's full depth, including intersected handles, halos, grille bars, and mounting features. They divide the existing solid without changing its shape. Each physical panel part prints with its material regions assembled, rather than as separate inlays or a shallow decorative skin. Split assembly creates two physical panel parts, each with its own aligned color regions. Front projection does not unwrap the angled control deck. Use compatible filaments and inspect bonding, sliced boundaries, supports, and tool changes; simple layer-height filament swaps cannot reproduce every pattern.

The provisional limits are **128 elements**, **128 vertices per polygon**, and **128 explicit palette materials** plus Background. Excess documents are rejected rather than trimmed. Geometry runs in a separate worker; palette RGB/name edits do not repartition the panel. Empty and occluded regions are omitted from exports. Small-region diagnostics use a provisional 0.8 mm reference, not a guaranteed printable minimum. Dense jobs can time out after 45 seconds; reduce complexity or retry. Browser profiling, complete slicer workflows, and physical print validation remain release checks.

## Recessed race stripes

In **Front panel → Race stripes**, enable **Recessed race stripes** and choose one to three stripes. The centered vertical grooves run from top to bottom wherever the panel has material, recessed 0.8 mm into the surface. They change the printable geometry without adding material assignments; multicolor patterns can cross the grooves independently.

**Stripe width** and **Stripe gap** each range from 1 to 20 mm. Their limits adjust together to keep the complete group within 54 mm, leaving room at the sides of the narrowest handle. Gap is inactive for one stripe. Changing the count can reduce the width to keep the group inside these limits.

LEGO-compatible studs leave clearance around each stripe. Raised and recessed grille surface patterns skip the stripe bands, while driver and grille openings remain open. Halos, control seats, and mounting geometry are preserved. Stripes follow added face depth, side extension, and panel spacing and appear in the shared preview and STL/STP exports. Settings are retained in saved designs, shared links, undo/redo, and the ZIP's `design.json`. Selecting **Original** in Panel shape turns stripes off while keeping their dimensions for later use.

## Generative halo

Select **Custom** in the **Halo** tab to generate a ring ready to edit. S receives one halo, and M receives identical halos around both driver openings. All controls apply to both M halos together, including the cutting angle, direction, and rim height. Switching back to S retains the settings and returns to one halo. **Full halo** starts with an uncut ring; **Rain hood** starts with an angled opening and a longer upper edge, like a street-light cover. These are starting shapes, and each dimension remains editable.

| Control        | Range                                 | Effect                                                                                                          |
| -------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Outward angle  | 0–45°                                 | Flares the wall away from the driver as it projects forwards. Zero creates a straight cylindrical wall.         |
| Halo depth     | 1–40 mm                               | Sets the maximum forward projection before wave modulation.                                                     |
| Wall thickness | 1–6 mm                                | Sets the radial thickness of the halo wall.                                                                     |
| Cutting angle  | 0–75°*                                | Cuts the entire front lip along one straight plane to shorten one side of the ring. Zero leaves the ring uncut. |
| Cut rotation   | 0–360°                                | Rotates the longer side clockwise: 0° points upwards and 90° points right.                                      |
| Rim height     | 0–5 mm                                | Leaves a continuous raised rim along the cut-away side. Zero ends flush with the panel face.                    |
| Waveform       | Off, sine, triangle, square, sawtooth | Modulates the height of the existing halo after its front cut.                                                  |
| Wave amplitude | 0–20 mm*                              | Sets the rise and fall at the original full-height tip; shorter cut sections scale proportionally.              |
| Wave frequency | 0.25–24 cycles                        | Sets the number of wave cycles around one full turn.                                                            |
| Wave phase     | 0–360°                                | Shifts the waveform through its cycle, starting at the top and proceeding clockwise around the ring.            |
| Seamless loop  | On / off                              | Uses the nearest whole frequency (at least one cycle) so the pattern repeats evenly around the ring.            |

\*The maximum cutting angle is the smaller of 75° and 89° minus the outward angle, so the plane can intersect the flared wall cleanly. For example, a 45° outward angle allows cuts up to 44°. Increasing the outward angle reduces an existing cutting angle when needed.

The cut passes through the longest outer tip at the selected halo depth, leaving a single angled lip. **Rim height** defaults to 0 mm for a flush finish where the cut reaches the panel. Increase it to preserve a continuous raised rim up to 5 mm high. The rim cannot exceed the halo depth; reducing the depth also reduces the rim height when needed. The halo stays joined to the panel at every setting.

**Height modulation** deforms the finished ring after the cut, before it joins the panel. The panel, buried attachment collar, and selected base rim stay fixed. Amplitude is limited to 90% of the depth above the base rim (and at most 20 mm), leaving material at wave troughs. A full-height base rim leaves no height to modulate. Waves can extend beyond the original halo depth. Square and sawtooth transitions have steep mesh faces. The diagram shows the original cut profile as a dashed line and the modulated outer lip as a solid line.

**Seamless loop** is enabled by default. The entered frequency is retained while the applied frequency is rounded: 2.6 cycles uses 3 complete cycles. Turn it off to use fractional cycles, with a transition where the ends meet. Phase shifts the wave itself: 360° returns to the same pattern. Select **Off**, or set amplitude to zero, to restore the halo's existing cut shape. Older saved designs open with modulation off.

**Original** removes the generated halos while keeping a custom grille. Selecting **Custom** restores the retained halo dimensions. Halo parameters are saved locally, included in shared design links and the exported `design.json`, and retained when switching speaker models.

The generated halo uses the original open panel as its base and combines with a custom handle, face depth, and a generated grille, including raised or recessed face patterns. Preview and STL export use the same connected solid. The rain-cover shape is a geometric option; weather resistance and print supports still require physical evaluation.

## Source models and printing

The original assets live in `resources/product-images/` and `resources/stl-files/`. Background and source information is available in the [Nothing Community announcement](https://nothing.community/d/63517-3d-print-your-own-cmf-speaker).

Both panel modes use the `panel-original` file for the selected speaker model. The numbered alternate panel files remain in the repository but are no longer loaded by the designer. All selectable knob geometries use `cmf-speaker-sm-3d-printing-knob-original-v1.stl` as their source. Each knob is extracted as its own connected part. The power button uses `cmf-speaker-sm-3d-printing-power-button-original-v1.stl` for both speaker sizes, preserving its mounting features and original dimensions. The combined `panel-merge` files remain available in the repository but are not exported by the designer.

The original panels measure approximately 85 × 131 mm for S and 85 × 225 mm for M. Added face depth affects the front surface. Side extension widens the front and angled section while the handle keeps its selected width. Panel gap offsets each section along its outward normal, extends the attachment necks while retaining the original locking ends, and adds rear support posts. The original control seats stay fixed inside recessed wells, so the existing knob and button are not raised. A custom handle changes the overall panel bounds, shown in the preview and download summary. Its base is 4 mm thick, with optional studs extending another 1.8 mm from the front, an extension height of 16–70 mm, and width of 60–110 mm. Corner radius, hole sizes, and offsets are limited together to retain the connecting shoulder and minimum wall thickness.

The generated upper section is joined with a Boolean union into one connected solid above the preserved control deck. Boolean operations can retessellate the original lower mesh; the generator uses a 0.00005 mm simplification tolerance to resolve numerical slivers. Downloads orient the front toward the print bed and place the lowest point at Z=0, with coordinates expressed in millimeters. Import at 100% scale and check orientation, supports, and material settings in your slicer before printing.

The automated checks validate mesh topology, attachment geometry, actual openings, raised face patterns, and STL serialization. Physical fit, printer tolerances, carrying strength, and acoustic performance still need validation with test prints on the actual speakers. The 3 mm handle material constraint is a geometry limit, not a load rating. The speaker body shown in the preview is an approximate context model. Downloads include the selected front panel with its integrated handle, grille, and halo, the separate volume knob, and the original power button, according to the export selection. The speaker body is preview context only.

Choose the **Power button** color in the Front panel tab using palette swatches or any custom color. It is saved as `powerButtonColor` in designs and share links, supports undo/redo, and is included as a separate material in 3MF. Legacy designs inherit their panel color for the button on first load. The source button has a plain face; the white factory indicator marking remains a preview detail and is not exported.

## Volume knobs

The **Knob** tab selects Ring, Bar, Cross, Fluted, Faceted, Triangle, Arrow, V, or Text. Ring, Bar, and Cross come from the supplied original collection. Fluted and Faceted are additional grip shapes derived from the original ring mesh. Triangle, Arrow, V, and Text add raised grips to the original mounting base. Color presets and a custom picker work independently of the front panel, and the selected shape, dimensions, and color are retained in saved designs and share links. Existing links without knob settings open with the Bar knob.

Selecting the Knob tab opens the close-up **Knob only** preview. Use **Speaker** or **Exploded** to inspect it alongside the panel. The base diameter, entire lower collar, mounting stem, and internal socket remain at their original STL dimensions. There is no diameter or rigid rotation control; old saved values for these are discarded when a design opens. Only the grip above the collar changes. Adjust its height and inward taper; Fluted grips offer Straight, Spiral, and Chevron paths with flute count and depth, while Faceted grips offer an adjustable face count. Generative details stay within the original outer diameter. Unmodified supplied styles retain their exact source geometry. The Heart from the larger collection has different mounting dimensions and is no longer offered; saved Heart selections open as Bar. Preview and export use the same mesh, with dimensions measured from it; each knob STL contains one part, with its lowest point at Z=0. Check fit, grip clearance, and printing supports with a test print.

Triangle, Arrow, and V also offer **Grip width** and **Grip depth**, measured across the grip at the collar. Their limits adjust together to keep the entire shape inside the original 18 mm base. Arrow adds **Shaft width**, and V adds **Stroke width** measured across each arm; the V stroke limit keeps its center open. **Reset grip** restores the selected shape's default dimensions. These controls work with saved designs, shared links, random designs, and all knob export formats.

**Text** turns one or two visible characters into a raised grip. Choose from the same bundled fonts and real font weights as multicolor text. The outlines are centered and scaled proportionally to fit inside the circular collar, including wide pairs, narrow letters, holes, and dots. **Knob height** and **Grip taper** control the extrusion; font size is automatic. Unsupported characters and invalid drafts show an inline explanation while preview and export retain the last valid text. Characters and font settings are included in saved designs, share links, undo/redo, and export metadata.

## Export and design files

Choose **Export design**, then a format and **All parts**, **Panel only**, **Knob only**, or **Power button only**. Single-color designs default to STL; Multicolor defaults to 3MF. Material exports containing the panel wait for regions matching the current design. Combined geometry exports remain available without material separation. The table describes one-piece panels; with **Split front and upper panel**, each panel becomes two print objects, and panel STL/STP exports always include both files in a ZIP.

| Format        | Output and use                                                                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3MF**       | One panel assembly with named material meshes and display colors. All parts adds separate, positioned knob and power button objects with their own colors. The archive contains authored settings in `Metadata/design.json` and object/material mapping in `Metadata/materials.json`.                                     |
| **STL parts** | A ZIP with one STL per used panel material, separate knob and power button files when All parts is selected, `design.json`, `materials.json`, and import instructions. Import panel-material STLs together as parts of one object. Preserve their common placement; do not center, arrange, or drop regions individually. |
| **STL / STP** | Combined panel geometry without multicolor separation. All parts produces a ZIP with three separate part files and `design.json`; any individual part downloads directly.                                                                                                                                                 |

3MF colors express design intent; they do not select printer filament slots. Assign and confirm filaments in the slicer. A material can contain several disconnected islands, all sharing the panel's print transform. The knob and power button stay separate printable objects. Use **Load design JSON** to reopen settings, including JSON extracted from an export; the designer does not import arbitrary 3MF/STL geometry.

STP exports use conventional AP214 advanced B-rep solids with explicit millimeter units and the same print orientation as STL. STEP preparation reduces excess mesh detail within a **0.01 mm surface tolerance**, preserves holes and separate shells, and combines coplanar triangles into shared planar faces. Curved surfaces remain faceted; the files do not reconstruct smooth CAD surfaces or contain parametric feature history. Preparation runs in a worker so the interface stays responsive. The ZIP records the STEP tolerance as `export.toleranceMm`. STL retains the full preview mesh. Neither export writes the preview colors into the part files; the ZIP retains them in `design.json`.

Multicolor release validation is incomplete. The production build, 390 unit/integration tests, and 54 production browser scenarios pass; four additional development-only parser checks pass. Bambu Studio **2.7.1.57** imported five real S/M flag fixtures through `--info`, reporting manifold geometry and expected dimensions. Its `--export-3mf` attempt crashed during macOS graphics initialization, so this does not establish filament assignability, slicing, or slicer-project round trips. PrusaSlicer/OrcaSlicer workflows and physical bonding/fit tests are still pending. See [the plan's progress record](plans/multicolor-extension.md#implementation-status--2026-10-15) for the verification details.

## Implementation

- **Vite, React, and TypeScript** provide the application shell and production build.
- **shadcn/ui components, Radix UI, and Tailwind CSS** provide buttons, the face-depth slider, and accessible dialogs, with custom product-inspired styling.
- **Three.js, React Three Fiber, and Drei** provide mesh loading, material previews, lighting, and camera interaction.
- **Manifold** performs solid Boolean operations in WebAssembly workers, keeping structural generation and multicolor partitioning off the main UI thread.
- Both the designer and variation explorer prepare panel and knob meshes in workers, including STL parsing, deformation, normal smoothing, and bounds. Panel sources stay cached in the worker across variations. Completed position/normal/index buffers are transferred to the preview without copying or repeating vertex scans on the main thread. Rendering and GPU uploads remain on the main thread.
- `src/lib/worker-client.ts` serializes panel and knob jobs, removes cancelled queued work, ignores obsolete results, and restarts failed or timed-out workers. `geometry-transfer.ts` preserves mesh metadata and bounds alongside the transferred buffers. Existing previews remain visible during edits; only current results can export.
- `src/lib/panels.ts` owns source selection, model coordinates, face-depth transformations, and STL exports.
- `src/lib/face-depth.ts` carries the original rounded corner into the deeper face and joins it to the unchanged 45° control deck. Local triangle subdivision keeps the front planar and shared edges watertight in both the preview and STL.
- `src/lib/panel-normals.ts` smooths curved surfaces while keeping flat faces uniformly shaded and sharp edges crisp.
- `src/lib/handle-settings.ts` validates dependent handle dimensions and material constraints.
- `src/lib/handle-geometry.ts` trims the source upper section and generates a connected handle with real cutouts; `handles.worker.ts` runs this kernel in the browser.
- `src/lib/grille-settings.ts` constrains grille dimensions and defines the shared pattern layout; `grille-geometry.ts` joins perforated inserts and creates recessed or raised face patterns while preserving case attachments.
- `src/lib/halo-settings.ts` constrains halo dimensions; `halo-geometry.ts` generates a flared annular wall, trims it with the selected cutting plane, and joins it to the panel.
- `src/lib/race-stripe-settings.ts` validates centered stripe dimensions and shares their intervals with stud placement; `race-stripe-geometry.ts` cuts the recessed bands into the panel.
- `src/lib/multicolor-settings.ts`, `multicolor-patterns.ts`, and `multicolor-presets.ts` own the versioned artwork document, primitive contours, generators, and editable flag recipes.
- `src/lib/multicolor-vector.ts` combines imported SVG paths into material outlines; `multicolor-fonts.ts` generates lettering from bundled fonts, with families and real weights listed in `multicolor-font-catalog.ts`. New font faces are compressed and expanded only when used. Attribution and regeneration instructions are in `src/assets/fonts/README.txt`.
- `src/components/MulticolorEditor.tsx` and `MulticolorCanvas.tsx` provide the layer/material inspector and 2D placement editor.
- `src/lib/multicolor-geometry.ts` partitions the final solid and reports region diagnostics; `multicolor-mesh.ts` prepares printable and smoothed preview meshes in the worker. `multicolor-client.ts`, `multicolor.worker.ts`, and `use-multicolor-geometry.ts` handle worker scheduling, disposal, and current-result gating.
- `src/lib/panel-engine.ts` combines handle generation, the shared face-depth transformation, grille generation, and halo generation in order inside the worker.
- `src/lib/panel-split.ts` optionally separates the completed panel into front and upper solids, with a reinforced groove and sliding tongue. Both part buffers travel with the assembled preview for separate exports.
- `src/lib/use-panel-geometry.ts` schedules geometry updates, retains the last preview during generation, and enables export when the current design is ready.
- `src/lib/knob-settings.ts` validates knob styles and dimensions; `knobs.ts` extracts the source parts, preserves the mounting interface, and builds the preview/export geometry.
- `src/lib/use-knob-geometry.ts`, `knob-client.ts`, and `knobs.worker.ts` load and update knobs in a worker while preventing stale geometry from being exported.
- `src/lib/design-export.ts` writes STL/STP, multipart 3MF, and aligned material STL ZIPs. `three-mf-export.ts` serializes material assemblies and derives one shared panel print transform; `archive.ts` packages the archives.
- `src/lib/step-export.ts` writes AP214 solids with shared edges and planar faces; `step-faces.ts` combines coplanar regions while retaining hole boundaries.
- `src/lib/step-mesh.ts` prepares STEP geometry within the tolerance in `step-settings.ts`. `step-export-client.ts` and `step-export.worker.ts` keep preparation and serialization off the UI thread.
- `src/lib/step-import.test.ts` independently imports complete panel and knob exports with OpenCascade, checking actual geometry rather than file text alone. `occt-import-js` is a development dependency only.
- `src/lib/design.ts` validates shared, locally stored, and imported design settings; `design-files.ts` downloads portable design JSON.
- `src/components/SpeakerPreview.tsx` renders the selected panel and the contextual speaker body.
- `src/components/DesignerPreview.tsx`, `DesignControls.tsx`, and `PanelEditor.tsx` compose the preview and editing workspace; `ExportDialog.tsx` and `PrintGuide.tsx` own the dialogs.
- `src/lib/use-design-geometry.ts` composes the panel, knob, power-button, and multicolor geometry state used by previews and exports.
- `src/lib/use-design-interactions.ts` handles undo/redo shortcuts and groups slider and numeric input gestures into history transactions.
- `src/App.tsx` connects the controls, preview, and download workflow.

Models and the geometry generator are loaded on demand. Large STL resources and the WebAssembly module are part of the deployable assets, so a first load can take a moment. No backend, account, or API key is required; geometry processing and export run in the browser. Existing saved designs and shared links that select a numbered alternate panel now open as **Original**, or **Custom** when they include an active custom halo or grille. Other saved parameters are retained.

## Deploy to cmfspeakerdesigner.com

Import this repository into Vercel and select **Node.js 24.x** in the project's build settings. [`vercel.json`](vercel.json) supplies the Vite preset, `npm ci` installation, `npm run build`, and `dist/` output directory. No environment variables, backend, or API keys are needed.

Add **cmfspeakerdesigner.com** and **www.cmfspeakerdesigner.com** in the project's domain settings, follow the DNS records Vercel supplies, and wait for HTTPS certificates to be issued. Connect **www.cmfspeakerdesigner.com** to Production and redirect **cmfspeakerdesigner.com** to it in **Settings → Domains**, preserving paths and shared-design query parameters. This matches the current deployment. Domain redirects belong in those settings; `vercel.json` deliberately has no competing host redirect. A reverse rule in the repository would create a redirect loop for scripts, styles, and other assets. Metadata and the sitemap use `https://www.cmfspeakerdesigner.com/`. Both public domains are excluded from the preview-only `X-Robots-Tag: noindex, nofollow` rule.

Vite's content-hashed files under `/assets/`, including models, fonts, the geometry workers, and WebAssembly, can be cached for one year. HTML and files copied from `public/` revalidate on each use so metadata, icons, and crawler files update after deployment. Shared designs use query parameters or URL fragments on `/`; fragment artwork stays in the browser and is not sent to the server. There is no catch-all rewrite, so missing assets and unknown paths return a real 404.

The app includes canonical, Open Graph, Twitter card, and structured metadata; a 1200 × 630 social image at `/og-image.png`; `/robots.txt` and `/sitemap.xml`; and `/site.webmanifest` with standard and maskable app icons. A standalone `/404.html` provides a route back to the designer, and the main page has a readable JavaScript-disabled fallback. The manifest supports an installed app window; it does not add offline caching.

The social image and raster icons are committed in `public/`, so deployment does not require a browser. To regenerate them after changing the brand assets or [`scripts/og-card.html`](scripts/og-card.html), run `npm run assets:generate` locally with Google Chrome installed. The script uses the existing product photography and SVG favicon. Set `PLAYWRIGHT_CHROMIUM_CHANNEL=chromium` to use an installed Playwright Chromium instead.

The response headers restrict scripts and network requests to this origin, block framing, and disable unused device permissions. The Content Security Policy permits WebAssembly compilation for Manifold, local workers, and inline styles used by React/Radix. It does not permit inline executable scripts or JavaScript `eval`. Keep the Vercel Toolbar disabled for this project; its injected third-party scripts are outside this policy. If external services are added later, update the policy for those specific origins.

Before promoting a deployment, run the local checks and production browser checks:

```sh
npm ci
npm run check
npm test
npm run test:production
```

The production preview applies the global security headers from `vercel.json`, so the browser suite exercises the Content Security Policy, including the WebAssembly worker. The development server remains configured for Vite's development tooling.

After deployment, run `npm run check:deployment` to check the live apex-to-www redirect, shared query parameters, production security/indexing headers, linked scripts/styles/icons, crawler files, social image, manifest, and real 404 responses. This check catches redirect loops and asset requests crossing to a different origin. Open a shared design and generate/download a custom panel to exercise the deployed worker and `.wasm` asset. Confirm that previews send `X-Robots-Tag: noindex, nofollow` and production sends the expected cache headers. Vite's local preview does not emulate Vercel's host redirects, cache rules, conditional indexing headers, or 404 behavior; these domain smoke checks must be performed on the deployment even when the local suite passes. The [Vercel configuration reference](https://vercel.com/docs/project-configuration/vercel-json) documents these settings, and [Vercel's domain redirect guide](https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting) describes managing the primary domain.

When upgrading from the original deployment config, redeploy after removing its `www`-to-apex redirect. Keep the existing apex-to-www domain setting. If a browser still follows an old permanent redirect, hard-refresh with the browser's cache disabled or verify in a fresh private window.

Other static hosts can serve the complete `dist/` directory at the domain root. Apply equivalent HTTPS, redirect, header, and cache rules there. The repository does not provision hosting or change DNS.

Application code is covered by the repository's [MIT license](LICENSE). The supplied product photography and model files retain their respective owners' rights.
