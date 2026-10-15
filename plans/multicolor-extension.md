# Generative multicolor front-panel extension

Date: 2026-10-15  
Status: implementation plan; no application changes made  
Primary printing workflow: one assembled multicolor print, using 3MF and separate material regions, as selected by the user.

## 1. Product goal and main decisions

Add **Single color / Multicolor** to **Front panel → Colors**. Selecting Multicolor reveals a configurator for composing freely positioned stripes, crosses, circles, and related geometric patterns. Users can start from a flag, generate repeated stripes, or build a composition from scratch. Every preset becomes editable shapes; country names must never determine rendering or export behavior.

The first release must support France, Italy, Germany, Switzerland, Norway, the United Kingdom, a rainbow flag, and Japan, plus arbitrary combinations of their underlying shapes. Users control colors, positions, dimensions, rotations, stacking, and element counts. Practical browser resource limits are explicit; the existing race-stripe limit of three does not apply.

Recommended implementation decisions:

- Keep color mode independent from Original/Custom panel shape. Multicolor works with both.
- Keep `panelColor` as the background material color. The knob retains its independent color.
- Use an ordered vector composition in front-view coordinates, with the topmost visible shape winning at overlaps.
- Partition the finished panel into non-overlapping, closed material volumes. The regions collectively reproduce the existing panel exactly.
- Start with **full-depth front projection**: a shape assigns material through the panel wherever its front-view footprint intersects existing solid geometry.
- Make multipart **3MF the primary multicolor export**. Include an aligned STL-per-material ZIP as a compatibility option.
- Preserve the existing single-color STL/STP workflow and offer an explicitly labeled combined geometry export for multicolor designs.
- Treat actual slicer import and physical print validation as release requirements. A colored preview alone does not complete this feature.

Full-depth regions are a deliberate first-release choice: they work with the existing folded panel, grilles, halos, and handles without inventing a surface-offset system. They also place color interfaces through the panel thickness and can increase filament changes. A shallow decorative skin with shared structural backing is a separate later enhancement, not an implicit promise of this release.

## 2. Current architecture and integration constraints

These findings come from the current repository:

| Area                  | Existing behavior                                                                                                                               | Consequence for this extension                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Front-panel controls  | [`PanelEditor.tsx`](../src/components/PanelEditor.tsx) owns panel shape, colors, dimensions, and recessed race stripes.                         | Put the new option and revealed configurator here.                                                   |
| Design state          | [`design.ts`](../src/lib/design.ts) defines `Design`, normalization, local saving, and shared URLs.                                             | Add a versioned multicolor document with disabled defaults for existing designs.                     |
| History               | [`design-history.ts`](../src/lib/design-history.ts) explicitly clones nested data and compares each field.                                      | Add deep snapshots and structural equality for the complete composition.                             |
| Structural geometry   | [`panel-engine.ts`](../src/lib/panel-engine.ts) builds side extension → handle → face depth → panel gap → grille → race stripes → halo.         | Partition only after this pipeline has produced the final solid.                                     |
| Geometry transport    | [`handles.ts`](../src/lib/handles.ts) and [`handles.worker.ts`](../src/lib/handles.worker.ts) return and transfer one position buffer.          | Extend the result contract and ownership rules for material meshes.                                  |
| Current preview       | [`SpeakerPreview.tsx`](../src/components/SpeakerPreview.tsx) renders one panel mesh with `panelColor`.                                          | Render the resolved material regions using the same geometry used for export.                        |
| Freshness             | [`use-panel-geometry.ts`](../src/lib/use-panel-geometry.ts) retains the previous preview but blocks export until the current geometry is ready. | Apply the same rule to material partitions and metadata.                                             |
| Export                | [`design-export.ts`](../src/lib/design-export.ts) supports STL/STP and ZIP metadata, with one panel mesh.                                       | Add an assembly-aware export input and 3MF serializer.                                               |
| Print orientation     | [`panels.ts`](../src/lib/panels.ts) rotates each exported panel mesh and grounds its individual minimum Z.                                      | Multipart export must calculate one transform from the whole assembly and reuse it for every region. |
| Existing race stripes | One to three centered grooves, recessed 0.8 mm, in the panel's material.                                                                        | Retain as an independent geometry feature; do not extend this schema into the color editor.          |

The application already uses Manifold in a worker and has independent geometry/download checks. Reuse those foundations. Keep generation local to the browser; this feature does not require a backend, account, or uploaded artwork.

## 3. User experience

### Entry point and initial state

Within the current Colors section:

1. Show a **Panel color mode** selector: **Single color** and **Multicolor**.
2. Single color retains the existing panel and knob pickers.
3. Multicolor relabels the panel picker **Background**, reveals the configurator, and retains the independent knob picker.
4. First activation starts with the current background and no shapes, with **Add shape**, **Generate stripes**, and **Choose preset** actions. Do not silently select a national flag.
5. Turning Multicolor off retains all shapes and their settings. Turning it back on restores them.
6. Choosing Original panel shape continues its current geometry behavior, while retaining the selected color mode and composition.

Keep the configurator in the Front panel inspector. A larger editing view may expand the canvas, but the feature should not require a new top-level tab or a wizard.

### Configurator layout

Use this order inside the revealed section:

1. Preset picker and stripe generator.
2. Front-view editing canvas with the actual panel outline and openings.
3. Ordered element list, with an add button.
4. Controls for the selected element.
5. Material palette and printability summary.

The existing 3D preview remains visible. The 2D canvas is the placement tool; rotating the speaker and positioning artwork must remain separate interactions.

### Element controls

Every element supports selection, name, material/color, visibility, duplicate, delete, and move forward/backward in the stack. Provide numeric controls for all geometric edits, alongside canvas dragging and handles. Shapes may extend beyond the artwork frame; the printable portion is clipped without destroying the authored shape.

Use millimeters for position and size. Include center, edge alignment, equal spacing, and optional snapping. Snapping must be easy to disable. Show values during dragging. A single drag, resize, rotation, preset application, or stripe generation is one undo action. Escape restores the state before a gesture; pointer capture loss ends or cancels it predictably.

The element list is ordered with the visually topmost element first. A fully covered or off-panel element remains editable, with a status explaining why it contributes no printed material.

### Color and material controls

- Allow arbitrary opaque RGB colors through the existing picker plus a hex field; do not restrict users to the built-in palette.
- Give materials stable IDs and editable names. Several shapes can reference the same material.
- Editing a material color updates all its assigned shapes. **Make unique** creates a new material for an individual shape.
- Keep the background material's color sourced from `panelColor`, avoiding two background values that can diverge.
- Do not automatically merge two distinct material IDs just because their hex colors match. Offer **Merge materials** as an explicit action.
- Display element count separately from **used materials**. Only materials with nonempty resolved volumes count toward export; the base can be completely covered.
- Removing a used material requires choosing a replacement within the edit operation. Unused palette entries may remain saved but are omitted from printable parts.

The current color presets should update background and knob colors while preserving multicolor shapes. Label that behavior clearly when Multicolor is active.

### Accessibility and mobile

Provide keyboard selection, add/delete/duplicate, stacking buttons, and numeric positioning without requiring dragging. Announce selection and completed generation through existing status patterns. Identify shapes using names, order, and outlines as well as color. Reuse numeric draft handling so incomplete input does not generate invalid geometry.

At 320–390 px widths, keep the layer list and controls reachable, use touch-sized handles, and allow canvas zoom/pan independently from page scrolling. Verify focus restoration when a preset picker or expanded editor closes.

## 4. Generative pattern model

### Primitive vocabulary

| Primitive          | Editable parameters                                                                                         | Examples                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Stripe / rectangle | Center X/Y, width, length, rotation, material; shortcut to span the frame                                   | Vertical/horizontal flags, diagonal bands, finite blocks, borders    |
| Cross              | Intersection X/Y, left/right/up/down arm lengths, horizontal and vertical bar thickness, rotation, material | Swiss cross, Nordic cross, unequal crosses, diagonal cross           |
| Circle / ring      | Center X/Y, outer radius, optional inner radius, material                                                   | Japanese disc, multiple discs, rings                                 |
| Polygon            | Ordered vertices, material, move/rotate/scale                                                               | Chevrons, triangles, clipped diagonal arms, related geometric motifs |

A cross is the union of its two bar rectangles and is one authored element. Independent arm lengths permit a bounded Swiss cross and an off-center Nordic cross. A rotated cross provides a symmetric saltire. Polygon support handles asymmetric compositions that a symmetric cross cannot express.

Start polygon editing with vertex coordinates and draggable vertices; freehand drawing and SVG import are not required. Reject self-intersecting polygons with a useful message. Circles use a geometric approximation with a defined chord-error budget; the 2D view and mesh generator share that resolution policy.

### Stripe generator

Provide count, horizontal/vertical/arbitrary direction, equal or weighted widths, gap, extent, and a palette sequence. Generate ordinary editable stripe elements in a labeled group. Positive gaps reveal the background. Count one must work, and there must be no flag-specific limit such as three or six.

The group retains generator settings for a **Redistribute / change count** action. That explicit action recalculates the group's positions and widths, preserves surviving material assignments where possible, and is one undo step. Make clear that it replaces manual placement within that group. Ungrouping leaves ordinary independent stripes. Duplicating and deleting individual stripes remains available at any time.

Cross and circle counts are controlled through repeated add/duplicate operations and optional repeat/distribute actions. Geometry generation must not depend on a fixed set of element slots.

### Composition rules

- Array order defines paint order; the topmost visible element owns each covered location.
- Overlap does not mix colors or create thickness. It changes material ownership.
- A shape assigned the background material still hides shapes beneath it.
- A ring has a transparent center that reveals lower layers; a background-colored disc instead paints over them.
- Hidden elements contribute no material. Fully covered shapes contribute no exported mesh.
- Grouping is organizational, with batch editing; it does not change compositing semantics.
- Filling the entire panel with shapes can eliminate the background part from the output.

This model supports arbitrary counts and combinations within measured resource limits. It is a geometric flag/pattern system; detailed coats of arms, text, and bitmap art are outside the first release.

## 5. Coordinates, panel changes, and preset behavior

### Coordinate contract

Use the application's existing physical coordinates: X across the panel, Y upwards, and +Z outwards toward the viewer. Store authored positions and dimensions in millimeters. Convert pointer coordinates from the SVG canvas into this system explicitly; screen Y points in the opposite direction.

Persist an artwork rectangle `{ centerX, centerY, width, height }`. It initially matches the front-view extent of the intended panel/handle area. The rectangle is an authoring and clipping frame, not additional solid geometry. Mounting protrusions must not unexpectedly enlarge the default artwork frame.

Store shapes directly in panel coordinates. Model, handle, and width changes preserve their physical dimensions and positions. Provide explicit **Fit artwork to panel** and **Reapply preset to panel** actions rather than automatically stretching authored geometry. Fit applies uniform scale and translation to the frame and all its elements; circles remain circles and cross thickness scales consistently.

For presets, offer two layouts:

- **Adapt to panel**: generate the recipe against the current artwork rectangle. Stripe and cross positions adapt to the available width/height; circles use a single radius based on the shorter side. This is a panel adaptation, not a claim of official flag proportions.
- **Keep flag proportions**: use the recipe's documented aspect ratio and fit it uniformly inside the panel frame. The background occupies the surrounding panel. Optional cover/crop can be an explicit alternative with visible crop bounds.

A front-projected circle looks circular from the front but has a stretched footprint on an angled surface. V1 does not unwrap the control deck or maintain constant surface-distance pattern dimensions.

### Required editable presets

| Preset         | Recipe and required behavior                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| France         | Three equal vertical bands, blue/white/red; each independently editable.                                                                                                     |
| Italy          | Three equal vertical bands, green/white/red.                                                                                                                                 |
| Germany        | Three equal horizontal bands, black/red/gold.                                                                                                                                |
| Switzerland    | Red background with a finite white cross and independently editable arms.                                                                                                    |
| Norway         | Red background, broad white Nordic cross, narrower blue cross; off-center intersection.                                                                                      |
| United Kingdom | Blue background, white and asymmetric red diagonals, then bordered upright red cross. Independently editable clipped arms/polygons preserve counterchanged diagonal offsets. |
| Rainbow        | Six horizontal colored bands initially; arbitrary count, order, orientation, and colors through the same generator.                                                          |
| Japan          | White background and one red circle, with editable center and radius.                                                                                                        |

The UK recipe must not be implemented as two centered nested diagonal crosses. The Flag Institute's recommended construction gives unequal white margins around the red diagonals and documents both 3:5 and 1:2 variants. Use its diagram as a reference, record the chosen variant in recipe metadata, and test the orientation at the hoist. [Flag Institute specification](https://www.flaginstitute.org/wp/uk-flags/union-flag-specification/).

Preset application replaces only the artwork, palette, and background in one undo action. It leaves model, knob, and geometry parameters intact. Keep preset metadata informational: subsequent edits must never be overwritten because a preset ID remains attached. Verify reference proportions and document approximate display colors when implementing each recipe; screen RGB values are not exact filament specifications.

The actual speaker openings remain visible in the 2D canvas. A Japanese disc may sit entirely inside a driver opening and therefore produce no material. Explain this locally and offer move/resize or the existing grille controls; do not fill the opening automatically.

## 6. Design data, migration, and persistence

Add `multicolor` to `Design`. The following describes the contract, not final production TypeScript:

```ts
type MulticolorSettings = {
  version: 1
  enabled: boolean
  mapping: 'front-projection'
  depthMode: 'full-depth'
  frame: { centerX: number; centerY: number; width: number; height: number }
  materials: Array<{ id: string; name: string; color: string }>
  elements: PatternElement[] // bottom to top; stable IDs
  groups: PatternGroup[] // organization and optional generator recipe
  preset?: { id: string; revision: number; layout: 'panel' | 'proportional' }
}

type ElementCommon = {
  id: string
  name: string
  visible: boolean
  materialId: string // reserved 'base' resolves to Design.panelColor
  groupId?: string
}

// Discriminated union: stripe, cross, circle, polygon.
// Each kind stores only its own finite geometric parameters.
type PatternElement = ElementCommon & PrimitiveParameters
```

Material `base` is implicit and reserved; do not duplicate it in `materials`. Shapes can use it to paint the background over lower layers. Palette IDs and element IDs survive reorder, rename, and recolor.

Normalization must cover finite coordinates, positive sizes, valid inner/outer radius, valid cross dimensions, polygon validity, recognized kinds, bounded names, opaque hex colors, unique IDs, group membership, and material references. Use a documented canonical angle range. Validate payload size and complexity before invoking Manifold.

Compatibility behavior:

- Missing `multicolor` means disabled, preserving the appearance of every existing saved design and shared link.
- Keep the current local-storage key; migrate through `validateDesign` rather than discarding old settings.
- Unsupported future schema versions and oversized documents produce explicit load diagnostics. Do not silently slice off extra layers or save a partial reconstruction over the original payload.
- Deep-copy element parameters, polygon points, groups, and palettes into history snapshots; compare ordered structural values.
- Keep selection, canvas zoom, hover state, and pending numeric drafts outside the persisted design.
- Reset clears the composition and disables multicolor while preserving the selected speaker model, matching existing reset behavior.
- Extend Randomize with small, valid generated compositions as part of its documented whole-design replacement behavior; keep color/material counts modest and preserve undo.
- Share multicolor documents in the URL fragment, while continuing to read existing query-based links. Measure encoded length and provide a portable JSON download when a link exceeds the supported budget.
- Add a validated **Load design JSON** action alongside that portable download so large compositions can actually round-trip. This imports authored design settings, not arbitrary 3MF/STL geometry.
- Export the complete authored document and a separate mapping of resolved material IDs to exported objects/files.

Resource limits should guard complexity, not dictate flag design. Initial profiling cases should include 8, 32, 64, and 128 elements, including intersections and polygons. Choose and document the supported ceiling from browser memory/latency results. Warn before the limit and reject additions/imports beyond it without modifying the current design. Never advertise literally unlimited geometry.

## 7. Geometry architecture and partition algorithm

### Preserve the structural panel

Keep the current final panel mesh as canonical solid `S`. All existing handle, grille, halo, race-stripe, spacing, and depth operations finish before color partitioning. Multicolor modifies material ownership inside `S`; it does not add a coating, remove material, or repair the structural model differently.

In full-depth mode, the projection applies through all panel solid beneath the artwork frame, including grille bars, halo walls, the handle, recessed surfaces, and mounting features. Areas outside the frame receive the background material. Holes remain holes because material masks intersect only existing solid geometry. The speaker body, power button, and separate knob are outside this partition.

### Worker pipeline

1. Build or reuse the final structural solid and its bounds.
2. Compile each visible primitive to a 2D Manifold `CrossSection` in XY, applying its geometry/rotation and clipping to the artwork rectangle.
3. Extrude each mask beyond both Z bounds of the full panel. Use a bounded cutter margin; it is not a gap between material regions.
4. Initialize `remaining = S`.
5. Visit elements from topmost to bottommost. Split `remaining` by that element's prism into covered and remaining volumes. The installed Manifold API provides `split(cutter)` returning intersection and difference.
6. Associate each nonempty covered volume with the element ID. Consume its coverage even when it uses the background material.
7. Assign final remaining volume to `base`.
8. Group/union resolved regions by material ID only after layer precedence is resolved. A material may contain several disconnected closed components.
9. Return the canonical assembly, material meshes, source-element/material mapping, bounds, volumes, diagnostics, and generation identity.

Keeping resolved element regions available allows palette reassignment to regroup cached regions without rerunning the structural build. Changing only a material's hex/name requires neither splitting nor regrouping. Benchmark memory use before retaining both element and material meshes indefinitely.

Do not use coincident colored overlays, triangle-centroid classification, or surface textures as printable output: they cannot define closed volumetric parts at arbitrary boundaries.

### Required geometric invariants

- Every nonempty exported component is closed, finite, consistently wound, and has positive volume.
- Material interiors do not overlap. Shared boundary faces are expected; intentional clearance or interference is not.
- The union of all material regions equals `S` within an explicit numerical tolerance, tested with symmetric difference as well as volume and bounds.
- The material volumes sum to the original panel volume within that same error policy.
- The assembled union retains the existing connected-panel requirement. An individual material is allowed to have disconnected islands.
- Openings, control seats, attachments, race-stripe recesses, and outer dimensions are unchanged.
- Empty intersections do not create zero-volume objects or unnecessary material slots.
- Tangencies, coincident edges, and tiny residual islands cannot be silently repaired by independently changing neighboring parts.

Establish numerical tolerances against serialized mesh tests. Existing engines use very small simplification tolerances; these are unrelated to printer nozzle sizes. Avoid independently simplifying each material boundary, especially through the STEP simplification pipeline, because nominally matching interfaces could drift apart.

## 8. Preview, responsiveness, and lifecycle

Use separate identities for the structural geometry, ordered pattern geometry, material assignment, and palette appearance. Structural edits invalidate partitions; shape edits invalidate coverage; material reassignment regroups resolved regions; hex/name edits update rendering and metadata immediately.

Retain a fast 2D preview during dragging, debounce expensive partitioning, and keep the last valid 3D result visible with an updating indicator. Only expose export when the structural solid, partitions, material mapping, and current design revision agree. A stale preview must never authorize a stale download.

Extend worker results with all region buffers and transfer each buffer once. Define who owns and disposes each `BufferGeometry` and each Manifold object. Reject late responses by generation identity, coalesce queued requests, and provide a recovery path for failed or over-budget jobs. Benchmark whether worker restart is needed for cancellation of a long synchronous Boolean operation; promise cancellation alone does not stop WASM work.

Render material parts with the same lighting, camera, transforms, and exploded-panel position as the existing panel. Derive consistent exterior normals across material boundaries so a color boundary does not create an artificial shading crease. Do not also draw an opaque full-panel mesh underneath them. The canonical assembly remains useful for dimensions and fit calculations. Selection outlines belong to the editor and must not affect exports.

Suggested performance targets, to be measured and adjusted during the initial spike:

- Palette-only edits respond within one frame without geometry work.
- 2D dragging remains responsive with a typical 32-element composition.
- Ordinary 3–8-element flag partitions finish within about one second on a recorded reference desktop after loading; report slower generation honestly.
- Dense compositions cannot lock the main UI, exhaust memory silently, or leave export enabled with old parts.

## 9. Printable output and 3MF

### Primary 3MF contract

Generate a generic multipart 3MF model in millimeters, with one named closed mesh resource per used material, a component assembly for the panel, and one panel build item. Use deterministic resource IDs, stable material names, base-material references, and display colors. Multiple disconnected islands of one material remain associated with that material.

Use the supported 3MF Core package structure, including content types, relationships, and the model document. Serialize XML safely, index mesh vertices, and validate the archive independently. Preserve component topology when indexing: do not globally weld separate shells just because vertices at a point or edge contact share coordinates. Reuse or extract the existing ZIP utility if suitable; evaluate compression after measuring actual multicolor file sizes. Include versioned design/material metadata in a standards-compatible location and verify that extra metadata does not impair import.

Portable material colors express design intent. They do not guarantee automatic assignment to a printer's filament slots. The 3MF Core specification separates base-material display color from physical print-material mapping. The UI and print guide should instruct users to assign and confirm filaments for each part in their slicer. [3MF Core specification, §5.1](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md#51-base-material).

Do not embed an arbitrary printer profile, temperatures, purge settings, or vendor project metadata in the generic model. Test whether each targeted slicer preserves assembly structure and material identities before documenting compatibility. This release requires a working 3MF path; STL fallback alone does not satisfy the selected workflow.

### Shared positioning is mandatory

Calculate the print rotation and grounding translation from the complete canonical panel once. Apply exactly that matrix to every material part. Do not call the current per-mesh grounding helper independently for each part, and do not recenter islands or individual material meshes.

The export rotation is a rigid rotation, not artwork mirroring. Verify the UK hoist direction and another asymmetric test pattern after re-import and viewing the printed front.

For **Panel + knob**, place the knob as a separate object with its own valid print orientation and a non-overlapping plate position, calculated from the assembled panel bounds. Do not include it in the panel's material component assembly. Plate size/printer selection remains the slicer's responsibility.

### Export choices

| Selection                     | Result                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Multicolor panel, 3MF         | One multipart panel assembly with named material regions.                                                        |
| Multicolor panel + knob, 3MF  | Multipart panel plus separate knob object; complete design metadata.                                             |
| Multicolor parts, STL ZIP     | One aligned STL per used material, optional knob STL, `design.json`, material manifest, and import instructions. |
| Combined geometry, STL or STP | Existing unified panel geometry, explicitly labeled as discarding multicolor separation.                         |
| Knob only                     | Existing STL/STP behavior, plus 3MF if selected in the expanded format UI.                                       |
| Single-color design           | Preserve current defaults and outputs; 3MF can be an additional format.                                          |

When multicolor is active and the panel is selected, default the dialog to 3MF. Format changes should be explicit; do not silently fall back to a combined STL after an export error. Show used materials, swatches/names, the chosen export mode, and any validation failures.

The aligned STL ZIP should use stable filenames such as `panel-material-01-red.stl`, with authoritative IDs in its manifest. Each STL is geometry only. Import all material STLs together as parts of one object. Prusa's documented workflow requires a multicolor printer profile and confirmation that the files form one object with multiple parts. [Prusa import guidance](https://help.prusa3d.com/article/importing-multi-material-model_121191).

## 10. Printability rules and feature interactions

### Errors versus guidance

Block multicolor export for invalid topology, missing coverage, overlapping interiors beyond tolerance, inconsistent material references, failed generation, or stale results. Keep the authored design and last valid preview available for correction.

Provide actionable warnings for small material regions, narrow colored bands, tangencies, or an excessive number of materials relative to an optional user-entered printer capacity. Measure the resolved regions after clipping and overlap, not just the input stripe widths. Distinguish a valid geometric region from one likely to disappear during slicing.

Allow an optional nozzle/line-width and layer-height reference for diagnostics, with clearly labeled assumptions. Do not claim a universal minimum printable width. A reasonable starting heuristic is to highlight regions narrower than approximately two selected extrusion widths, then refine it through slicer and print tests. Do not automatically delete or expand small regions; offer explicit edits or material reassignment.

Explain in the print guide that full-depth color boundaries can cross handles and mounting features, so unchanged shape does not establish unchanged strength. Validate bonding using compatible filaments and representative prints. Color count and pattern orientation can affect tool changes and purge waste; exact estimates belong to the slicer. A simple layer-height filament swap cannot reproduce every pattern in this editor.

### Interaction matrix

| Existing feature                  | Required multicolor behavior                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Original / Custom panel           | Both supported; color mode is independent.                                                     |
| Face depth and side extension     | Partition the completed dimensions; preserve artwork until an explicit refit.                  |
| Panel gap, supports, attachments  | Preserve final shape/placement; full-depth regions can pass through them.                      |
| Grille and driver openings        | Color existing bars/rims; never bridge an opening.                                             |
| Grille face recesses              | Color the remaining surfaces without filling recesses.                                         |
| Recessed race stripes             | Keep the 0.8 mm grooves; color regions may cross them.                                         |
| Halos                             | Include them in final-solid projection; expect different apparent patterns from oblique views. |
| Handle, cutouts, top slits, studs | Preserve shape and openings; partition all intersected solid.                                  |
| Knob, body, power button          | Keep their current independent appearance/geometry behavior.                                   |

## 11. Implementation file map

| File or module                                        | Planned responsibility                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| New `src/lib/multicolor-settings.ts`                  | Types, defaults, normalization, IDs, schema/version and complexity constraints.      |
| New `src/lib/multicolor-patterns.ts`                  | Primitive outlines, transforms, frame clipping, generators, and grouping operations. |
| New `src/lib/multicolor-presets.ts`                   | Editable recipes, source/proportion metadata, and panel adaptation.                  |
| New `src/lib/multicolor-geometry.ts`                  | Manifold partitioning, material grouping, invariants, and generation metadata.       |
| New `src/lib/multicolor-diagnostics.ts`               | Resolved-region measurements and actionable printability messages.                   |
| New `src/components/MulticolorEditor.tsx`             | Configurator, element list, selected controls, material palette, presets.            |
| New `src/components/MulticolorCanvas.tsx`             | 2D view, selection, gestures, clipping display, and keyboard alternatives.           |
| New `src/lib/three-mf-export.ts`                      | Generic 3MF serialization and stable assembly/material resources.                    |
| New shared archive/assembly helpers                   | Reusable ZIP packaging and one panel-wide print transform.                           |
| `PanelEditor.tsx`, `ColorPicker.tsx`, `src/index.css` | Entry point, background label, hex entry, responsive layout and focus styles.        |
| `design.ts`, `App.tsx`, `random-design.ts`            | Additive migration, normalization, sharing/import, reset/randomize behavior.         |
| `design-history.ts`, `use-design-interactions.ts`     | Nested history equality/snapshots and canvas transactions.                           |
| `panel-engine.ts`, `handles.ts`, `handles.worker.ts`  | Post-build partition stage, result transport, caching and ownership.                 |
| `use-panel-geometry.ts`, `use-design-geometry.ts`     | Separate generation identities, current/stale results and lifecycle.                 |
| `SpeakerPreview.tsx`, `DesignerPreview.tsx`           | Material meshes, updating state, counts, and selection presentation.                 |
| `panels.ts`, `design-export.ts`, `ExportDialog.tsx`   | Shared transforms, export contracts/options, files and metadata.                     |
| `design-summary.ts`, `PrintGuide.tsx`, `README.md`    | Actual capabilities, material summaries, slicing instructions and limitations.       |

Avoid renaming the existing handle-worker infrastructure purely for naming consistency in this feature. Refactor its result contract where needed, keeping unrelated geometry behavior stable.

## 12. Verification and acceptance criteria

### Pattern and state tests

- All eight requested presets produce ordinary editable elements, and each can be modified beyond its preset recipe.
- Test independent coverage samples for stripe direction/order, finite Swiss arms, off-center Nordic cross, asymmetric UK diagonals, rainbow order, and a circular Japanese disc.
- Test arbitrary combinations, rotations, unequal widths, rings, multiple circles, off-panel placement, polygons, layer order, base-material overlays, and hidden/occluded shapes.
- Test stripe count changes, group redistribution, ungroup, duplicate/delete, material reuse, merge, and palette reassignment.
- Existing saved designs remain single-color and visually unchanged. New designs round-trip through storage, links, JSON import/export, and metadata.
- Test malformed values, unsupported versions, oversized input, duplicate IDs, missing references, and invalid polygons without corrupting the current design.
- Verify deep history isolation and one undo step for each gesture/bulk action; native input undo still works.
- Model changes preserve physical artwork; explicit fit keeps circles circular.

### Geometry and serialization tests

- Exercise Speaker S and M, with representative combinations and boundary values for extension, gap, face depth, grilles, recesses, race stripes, handles, studs, slits, and halos.
- Verify closed components, positive volume, no interior overlap, union coverage, dimensions, and connected assembly using independent inspection where possible.
- Test exact shared stripe boundaries, tangent circles, triple intersections, repeated materials, fully covered background, empty intersections, tiny islands, and artwork inside an opening.
- Compare unchanged openings, controls, and attachment locations against the canonical structural panel.
- Parse actual STL ZIPs and 3MF archives. Check resource/material references, units, component transforms, filenames, design metadata, and omission of empty parts.
- Re-import and compare material-part bounds and the assembled union. Explicitly catch accidental per-part grounding/recentering and orientation reversal.
- Verify combined STL/STP outputs retain the current structural shape and are labeled geometry only.

### Browser and performance tests

- Enable Multicolor from Front panel, create a custom composition, edit each primitive type, apply/rework a preset, disable/restore the mode, reload, share, and undo/redo.
- Verify mode independence from Original/Custom, knob color, and existing recessed race stripes.
- Confirm palette-only edits do not call the Boolean generator, and rapid geometry edits never export mismatched regions.
- Cover worker failure/retry, stale responses, cancellation/replacement, and disposal across repeated edits/model switches.
- Inspect actual downloads in Playwright. Cover keyboard-only editing, numeric drafts, touch/narrow layouts, focus, and preview failure behavior.
- Profile the documented complexity cases and record browser/device details before setting limits.

### Slicer and physical release gates

Record tested versions of PrusaSlicer, Bambu Studio, and OrcaSlicer. For each, import the generated 3MF and the STL fallback, confirm a single panel assembly with assignable material parts, assign filaments, and inspect sliced layers. Treat these as target consumers until validated, not already established compatibility.

Use a three-band pattern, a surrounded circle, Nordic cross, asymmetric UK pattern, six-color rainbow, and a design combining holes/halo/handle geometry. Verify material identity, shared position, correct front orientation, no lost islands, no unwanted surface-paint conversion, and no dropped or overlapping parts. Reopen a saved slicer project to check that the assembly survives the normal workflow.

Print representative color-boundary coupons, a circle/ring coupon, and at least one complete panel with interfaces near a mounting feature or handle. Check visual boundaries, fit, bonding, and practical feature size. Publish only minimum-feature/compatibility claims supported by these results.

Implementation validation should use the repository's existing commands: `npm test`, `npm run check`, targeted Playwright runs, and finally `npm run test:production`. Add meaningful multicolor suites; keep existing topology, fit, history, and export checks passing.

## 13. Delivery sequence

| Phase                          | Deliverable                                                                                         | Exit condition                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Geometry/export feasibility | Hard-coded stripe/circle partition of real S/M panels; candidate multipart 3MF and aligned STL ZIP. | Closed regions reconstruct the panel, common transforms are correct, and target slicers expose assignable parts. Record any importer constraints before building the full UI. |
| 1. Data and pattern core       | Versioned settings, primitives, clipping, stripe generation, migrations/history, preset recipes.    | Deterministic 2D coverage, editable presets, legacy compatibility, validated round trips.                                                                                     |
| 2. Configurator                | Front-panel mode, canvas, layer/material controls, numeric editing and accessibility.               | Users can author arbitrary mixed patterns and preserve them across normal editing flows.                                                                                      |
| 3. Production geometry         | Worker integration, caching, lifecycle, material rendering and diagnostics.                         | Both models and existing feature combinations satisfy partition invariants; export freshness is enforced.                                                                     |
| 4. Export and documentation    | 3MF, STL ZIP, unified geometry options, JSON round trip, updated summaries/guide.                   | Actual downloads import with stable parts/materials and the user can assign filaments without reconstructing alignment.                                                       |
| 5. Release validation          | Regression/performance suites, recorded slicer matrix and test prints.                              | Acceptance criteria pass and limitations are documented from evidence.                                                                                                        |

Phases 1 and the 2D editor can progress in parallel after the coordinate/schema contract is agreed. The production export implementation depends on the phase-0 interoperability result. Keep the feature unreleased if 3MF cannot yet preserve assignable material regions; do not substitute a preview-only feature or silently reduce scope to STL.

## 14. Follow-up capabilities and remaining engineering decisions

Later enhancements can add a shallow colored skin with shared backing, selective surface coverage, surface-unwrapped placement across the fold, saved user presets, imported vector artwork, mechanical inlays for separate printing, and tested slicer-specific project exports. Each needs its own explicit geometry/export semantics.

The following are engineering decisions to resolve during the feasibility phase, rather than additional prerequisites from the user:

- Which generic 3MF assembly/material representation imports reliably in the recorded slicer versions, and whether a clearly named compatibility variant is needed.
- Final element/vertex/material complexity ceilings, cancellation strategy, and cache size based on measured browser behavior.
- Numerical error thresholds that survive Float32 serialization without visible gaps or altered panel geometry.
- Practical diagnostic thresholds supported by slicing and print coupons.
- Recipe reference dimensions/colors and initial panel-adaptation defaults for each preset.

Completion means a user can select Multicolor, create and place any supported combination of stripes/crosses/circles and related shapes, choose arbitrary colors, save/share/reopen the design, and export a validated 3MF that prints as one assembled panel with separately assigned material regions.
