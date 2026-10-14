# CMF Speaker Designer

A browser-based front panel designer for CMF Speaker S and M, built as a proof of concept for **cmfspeakerdesigner.com**. The interface is a compact design workspace with a persistent 3D preview, an independently scrolling inspector, and a fixed export action for printable panels and volume knobs. Its warm grey surfaces, orange accents, fine rules, and dotted technical typography draw on the supplied product photography.

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
npm test         # Geometry, STL, and STEP export checks
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

The tests start Vite automatically when needed and cover the WebGL preview, model and style changes, saved colors, keyboard face-depth controls, generated handles, grilles, and halos, actual STL and STP downloads, and a narrow mobile layout. Downloads are inspected independently for closed edges, one connected component, hole topology, clear passages through each opening, solid backing behind face recesses, and the projection of an angled halo cover. STEP download checks verify the selected format, millimeter units, part bounds, and ZIP contents. Screenshots, downloaded files, and failure traces are written to the ignored `test-results/` directory. GitHub Actions runs the unit checks and full production browser suite on Node.js 24 for pushes and pull requests, retaining browser artifacts when a run fails.

To check the bundled geometry worker and WebAssembly module against a production build:

```sh
npm run build
PLAYWRIGHT_PREVIEW=1 npm run test:e2e -- --grep "generates a"
```

Development tests use port 5174; production-preview tests use port 4179. Development tests reuse an existing server; production tests start an isolated preview and fail if that port is occupied.

## Workspace and accessibility

The preview stays visible while the parameters scroll, including on phones. Model selection, editor tabs, and export stay within reach. Color presets are in the Front panel inspector; printing guidance and source files are available from the header. On exceptionally short screens, the layout allows page scrolling so controls remain reachable.

Use **Appearance** in the header to choose a light or dark theme and an orange or turquoise interface accent. Preferences are saved locally, independently of the speaker design and its shared URL. Accent colors use the existing app palette (`#f45427` orange, `#13b7b1` turquoise); the official product pages name these colorways but do not publish exact hex specifications.

Controls use larger text and targets, high-contrast selected states, and visible keyboard focus. Use the skip link to reach design controls, arrow keys or Home/End within the editor tabs, and arrow keys on sliders. Focus the 3D preview to rotate with arrow keys or zoom with +/−. Closing a dialog returns focus to its opener. Reduced-motion and forced-color preferences are supported.

**Randomize**, next to **Reset**, replaces all design settings with a fresh combination of colors and geometry. Both actions keep the selected Speaker S or M. Undo design changes with **⌘/Ctrl+Z**; redo with **⌘/Ctrl+Shift+Z** or **Ctrl+Y**. A slider drag or held arrow key is one undo step. Text and number fields keep their native editing shortcuts. History includes up to 100 changes in the current session; reloading starts a new history from the saved design.

## What the POC does

Choose **Black** or **Gray** under **Speaker body**, next to the model selection. Gray approximates the body and side radiator faces of the white speaker variant; panel and knob colors remain independent. The body choice is saved locally, shared in design links, and recorded as `bodyColor` in the ZIP's `design.json`. Older designs default to black. The body is preview context only and is not exported.

- Switch between Speaker S and M.
- Choose the original front panel or build a custom panel with parametric halos and grilles.
- Generate a halo around each driver with adjustable outward angle, depth, wall thickness, and an angled cut that can turn the ring into a rain-cover shape.
- Generate round, hexagonal, or slotted grilles with adjustable opening size, material spacing, arrangement, rotation, and thickness.
- Continue the grille pattern onto the surrounding front face as recesses up to 3 mm deep, with solid material behind them.
- Preview front panel and volume knob colors with a black or gray speaker body in an interactive Three.js scene, including panel-only and exploded views.
- Add up to 2 mm of face depth while retaining the original mounting region and overall face dimensions.
- Generate a custom upper handle: adjust its height, width, and rounded corners, then choose a solid face, one to three circular or slotted openings, or an uploaded SVG cutout.
- Add LEGO-compatible studs to the custom handle's front face.
- Change hole size, spacing, and position, with dependent dimensions constrained to leave at least 3 mm of surrounding material.
- Keep your current design locally and copy a link to share a configuration.
- Select the supplied ring, bar, and cross volume knobs, or generate fluted and faceted grips.
- Keep the original STL base diameter, collar, and socket fixed; shape the upper grip with height and inward taper.
- Generate straight, spiral, or chevron flutes with adjustable count and depth, or choose the number of faces on a faceted grip.
- Inspect the knob at full size in a dedicated preview, or see it mounted on either speaker.
- Choose binary **STL** or faceted **STP** (STEP) exports in millimeters. Download panel and knob together as a ZIP with separate part files and a `design.json` containing settings, colors, and export format, or download either part individually.

The designer starts from each model's original front panel mesh. **Custom** selects an open panel ready to configure in the **Halo** and **Grille** tabs; it does not add either feature automatically. Selecting **Original** removes generated halos and grilles while retaining their parameters for later use. The **Original handle** option retains the source upper section. **Custom handle** removes that upper section above the control deck and joins a newly generated extension to the remaining panel; its openings are actual through-holes in the exported solid. Carry loop, Three dots, and Solid presets provide starting points. STL has no color or unit metadata: the exported coordinates are intended as millimeters. The ZIP records panel and knob colors in `design.json`. Choose the corresponding filament or material in your slicer. This POC does not include freeform drawing, text embossing, slicer integration, or multi-material exports.

In **Handle → Custom handle**, enable **LEGO-compatible studs** to add studs on the flat front face. Studs use a nominal 4.8 mm diameter, 1.8 mm height, and 8 mm center spacing, following [Kevin McAleer's dimension reference](https://www.kevsrobots.com/blog/lego.html). The layout skips edges and cutouts, and each stud is joined to the handle in the preview and STL/STP exports. The setting is saved locally, shared in links, included in the ZIP's `design.json`, and supports undo/redo. Printed fit varies by printer and material; test the fit before printing a complete panel.

In **Handle → Custom handle → SVG**, upload a filled SVG (up to 256 KB) to use its shapes as through-cutouts. Adjust **Cutout width** and **Position**; the design keeps its proportions and fits inside the handle's 3 mm outer border. Internal detail spacing comes from your artwork. Use a stencil with bridges where needed: a cutout that leaves floating islands cannot be exported. Convert text and strokes to filled paths, and export inline styles without images, linked shapes, clipping, or masks. The uploaded geometry is saved locally, included in shared links and the ZIP's `design.json`, and participates in undo/redo. Switching cutout types retains the uploaded artwork; **Remove SVG cutout** clears it.

The **Grille** tab generates a perforated grille over the original driver openings: one on S and both on M. Custom grilles use the original open panel as their base and can be combined with a custom handle, halo, and added face depth. Selecting **Original grille** removes the generated grille; a custom halo can remain active.

**Continue across the face** continues the same pattern seamlessly from the through-holes into matching blind recesses across the front face, including along the driver opening rims. These are real surface geometry in the STL, with solid material behind each recess. The outside edges, control deck, and mounting regions are preserved. Preview and export share the same generated mesh, and grille dimensions are applied after added face depth so their selected thickness and recess depth stay in millimeters.

Recess depth ranges from 0.2 to 3 mm and is limited to the grille thickness minus 0.5 mm to retain a solid floor. A 2 mm grille allows recesses up to 1.5 mm; the default 3.5 mm grille allows the full 3 mm. Reducing grille thickness also reduces the recess depth when needed.

## Generative halo

Select **Custom** in the **Halo** tab to generate a ring ready to edit. S receives one halo, and M receives identical halos around both driver openings. All controls apply to both M halos together, including the cutting angle, direction, and rim height. Switching back to S retains the settings and returns to one halo. **Full halo** starts with an uncut ring; **Rain hood** starts with an angled opening and a longer upper edge, like a street-light cover. These are starting shapes, and each dimension remains editable.

| Control        | Range   | Effect                                                                                                          |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| Outward angle  | 0–45°   | Flares the wall away from the driver as it projects forwards. Zero creates a straight cylindrical wall.         |
| Halo depth     | 1–40 mm | Sets the maximum forward projection from the panel face.                                                        |
| Wall thickness | 1–6 mm  | Sets the radial thickness of the halo wall.                                                                     |
| Cutting angle  | 0–75°*  | Cuts the entire front lip along one straight plane to shorten one side of the ring. Zero leaves the ring uncut. |
| Cut rotation   | 0–360°  | Rotates the longer side clockwise: 0° points upwards and 90° points right.                                      |
| Rim height     | 0–5 mm  | Leaves a continuous raised rim along the cut-away side. Zero ends flush with the panel face.                    |

\*The maximum cutting angle is the smaller of 75° and 89° minus the outward angle, so the plane can intersect the flared wall cleanly. For example, a 45° outward angle allows cuts up to 44°. Increasing the outward angle reduces an existing cutting angle when needed.

The cut passes through the longest outer tip at the selected halo depth, leaving a single angled lip. **Rim height** defaults to 0 mm for a flush finish where the cut reaches the panel. Increase it to preserve a continuous raised rim up to 5 mm high. The rim cannot exceed the halo depth; reducing the depth also reduces the rim height when needed. The halo stays joined to the panel at every setting.

**Original** removes the generated halos while keeping a custom grille. Selecting **Custom** restores the retained halo dimensions. Halo parameters are saved locally, included in shared design links and the exported `design.json`, and retained when switching speaker models.

The generated halo uses the original open panel as its base and combines with a custom handle, face depth, and a generated grille, including recessed face patterns. Preview and STL export use the same connected solid. The rain-cover shape is a geometric option; weather resistance and print supports still require physical evaluation.

## Source models and printing

The original assets live in `resources/product-images/` and `resources/stl-files/`. Background and source information is available in the [Nothing Community announcement](https://nothing.community/d/63517-3d-print-your-own-cmf-speaker).

Both panel modes use the `panel-original` file for the selected speaker model. The numbered alternate panel files remain in the repository but are no longer loaded by the designer. All selectable knob geometries use `cmf-speaker-sm-3d-printing-knob-original-v1.stl` as their source. Each knob is extracted as its own connected part. The combined `panel-merge` files and separate power buttons remain available in the repository but are not exported by the designer.

The original panels measure approximately 85 × 131 mm for S and 85 × 225 mm for M. Added face depth affects the front surface; the attachment region and folded control plate stay unchanged. A custom handle changes the overall panel bounds, shown in the preview and download summary. Its base is 4 mm thick, with optional studs extending another 1.8 mm from the front, an extension height of 16–70 mm, and width of 60–110 mm. Corner radius, hole sizes, and offsets are limited together to retain the connecting shoulder and minimum wall thickness.

The generated upper section is joined with a Boolean union into one connected solid above the preserved control deck. Boolean operations can retessellate the original lower mesh; the generator uses a 0.00005 mm simplification tolerance to resolve numerical slivers. Downloads orient the front toward the print bed and place the lowest point at Z=0, with coordinates expressed in millimeters. Import at 100% scale and check orientation, supports, and material settings in your slicer before printing.

The automated checks validate mesh topology, attachment geometry, actual openings, solid backing behind decorative recesses, and STL serialization. Physical fit, printer tolerances, carrying strength, and acoustic performance still need validation with test prints on the actual speakers. The 3 mm handle material constraint is a geometry limit, not a load rating. The speaker body shown in the preview is an approximate context model. Downloads include the selected front panel with its integrated handle, grille, and halo, the separate volume knob, or both, according to the export selection. The speaker body and power button are preview context only.

## Volume knobs

The **Knob** tab selects Ring, Bar, Cross, Fluted, or Faceted. Ring, Bar, and Cross come from the supplied original collection. Fluted and Faceted are additional grip shapes derived from the original ring mesh. Color presets and a custom picker work independently of the front panel, and the selected shape, dimensions, and color are retained in saved designs and share links. Existing links without knob settings open with the Bar knob.

Selecting the Knob tab opens the close-up **Knob only** preview. Use **Speaker** or **Exploded** to inspect it alongside the panel. The base diameter, entire lower collar, mounting stem, and internal socket remain at their original STL dimensions. There is no diameter or rigid rotation control; old saved values for these are discarded when a design opens. Only the grip above the collar changes. Adjust its height and inward taper; Fluted grips offer Straight, Spiral, and Chevron paths with flute count and depth, while Faceted grips offer an adjustable face count. Generative details stay within the original outer diameter. Unmodified supplied styles retain their exact source geometry. The Heart from the larger collection has different mounting dimensions and is no longer offered; saved Heart selections open as Bar. Preview and export use the same mesh, with dimensions measured from it; each knob STL contains one part, with its lowest point at Z=0. Check fit, grip clearance, and printing supports with a test print.

Choose **Export design**, then **STL** or **STP** under **Export format**. STL is selected by default. The default **Panel + knob** export is a ZIP containing two part files in the selected format and `design.json`. The parts remain separate so different filaments can be used. The JSON retains both color hex values, all design parameters, and the selected `export.format`; the app does not currently provide a file-import control. Choose **Panel only** or **Knob only** for a direct `.stl` or `.stp` download.

STP exports use conventional AP214 advanced B-rep solids with explicit millimeter units and the same print orientation as STL. STEP preparation reduces excess mesh detail within a **0.01 mm surface tolerance**, preserves holes and separate shells, and combines coplanar triangles into shared planar faces. Curved surfaces remain faceted; the files do not reconstruct smooth CAD surfaces or contain parametric feature history. Preparation runs in a worker so the interface stays responsive. The ZIP records the STEP tolerance as `export.toleranceMm`. STL retains the full preview mesh. Neither export writes the preview colors into the part files; the ZIP retains them in `design.json`.

## Implementation

- **Vite, React, and TypeScript** provide the application shell and production build.
- **shadcn/ui components, Radix UI, and Tailwind CSS** provide buttons, the face-depth slider, and accessible dialogs, with custom product-inspired styling.
- **Three.js, React Three Fiber, and Drei** provide mesh loading, material previews, lighting, and camera interaction.
- **Manifold** performs solid Boolean operations in a WebAssembly worker, keeping handle, grille, and halo generation off the main UI thread.
- `src/lib/panels.ts` owns source selection, model coordinates, face-depth transformations, and STL exports.
- `src/lib/face-depth.ts` carries the original rounded corner into the deeper face and joins it to the unchanged 45° control deck. Local triangle subdivision keeps the front planar and shared edges watertight in both the preview and STL.
- `src/lib/panel-normals.ts` smooths curved surfaces while keeping flat faces uniformly shaded and sharp edges crisp.
- `src/lib/handle-settings.ts` validates dependent handle dimensions and material constraints.
- `src/lib/handle-geometry.ts` trims the source upper section and generates a connected handle with real cutouts; `handles.worker.ts` runs this kernel in the browser.
- `src/lib/grille-settings.ts` constrains grille dimensions and defines the shared pattern layout; `grille-geometry.ts` joins perforated inserts and cuts blind decorative recesses.
- `src/lib/halo-settings.ts` constrains halo dimensions; `halo-geometry.ts` generates a flared annular wall, trims it with the selected cutting plane, and joins it to the panel.
- `src/lib/panel-engine.ts` combines handle generation, the shared face-depth transformation, grille generation, and halo generation in order inside the worker.
- `src/lib/use-panel-geometry.ts` schedules geometry updates, retains the last preview during generation, and enables export when the current design is ready.
- `src/lib/knob-settings.ts` validates knob styles and dimensions; `knobs.ts` extracts the source parts, preserves the mounting interface, and builds the preview/export geometry.
- `src/lib/use-knob-geometry.ts` loads and updates knobs while preventing stale geometry from being exported.
- `src/lib/design-export.ts` writes individual STL or STP files, or a ZIP with both parts and saved colors/settings.
- `src/lib/step-export.ts` writes AP214 solids with shared edges and planar faces; `step-faces.ts` combines coplanar regions while retaining hole boundaries.
- `src/lib/step-mesh.ts` prepares STEP geometry within the tolerance in `step-settings.ts`. `step-export-client.ts` and `step-export.worker.ts` keep preparation and serialization off the UI thread.
- `src/lib/step-import.test.ts` independently imports complete panel and knob exports with OpenCascade, checking actual geometry rather than file text alone. `occt-import-js` is a development dependency only.
- `src/lib/design.ts` validates shared and locally stored design settings.
- `src/components/SpeakerPreview.tsx` renders the selected panel and the contextual speaker body.
- `src/components/DesignerPreview.tsx`, `DesignControls.tsx`, and `PanelEditor.tsx` compose the preview and editing workspace; `ExportDialog.tsx` and `PrintGuide.tsx` own the dialogs.
- `src/lib/use-design-geometry.ts` owns source loading, disposal, and the panel/knob geometry state used by previews and exports.
- `src/lib/use-design-interactions.ts` handles undo/redo shortcuts and groups slider and numeric input gestures into history transactions.
- `src/App.tsx` connects the controls, preview, and download workflow.

Models and the geometry generator are loaded on demand. Large STL resources and the WebAssembly module are part of the deployable assets, so a first load can take a moment. No backend, account, or API key is required; geometry processing and export run in the browser. Existing saved designs and shared links that select a numbered alternate panel now open as **Original**, or **Custom** when they include an active custom halo or grille. Other saved parameters are retained.

## Deploy to cmfspeakerdesigner.com

Import this repository into Vercel and select **Node.js 24.x** in the project's build settings. [`vercel.json`](vercel.json) supplies the Vite preset, `npm ci` installation, `npm run build`, and `dist/` output directory. No environment variables, backend, or API keys are needed.

Add **cmfspeakerdesigner.com** and **www.cmfspeakerdesigner.com** in the project's domain settings, follow the DNS records Vercel supplies, and wait for HTTPS certificates to be issued. Connect **www.cmfspeakerdesigner.com** to Production and redirect **cmfspeakerdesigner.com** to it in **Settings → Domains**, preserving paths and shared-design query parameters. This matches the current deployment. Domain redirects belong in those settings; `vercel.json` deliberately has no competing host redirect. A reverse rule in the repository would create a redirect loop for scripts, styles, and other assets. Metadata and the sitemap use `https://www.cmfspeakerdesigner.com/`. Both public domains are excluded from the preview-only `X-Robots-Tag: noindex, nofollow` rule.

Vite's content-hashed files under `/assets/`, including models, fonts, the geometry worker, and WebAssembly, can be cached for one year. HTML and files copied from `public/` revalidate on each use so metadata, icons, and crawler files update after deployment. All shared designs use query parameters on `/`; there is no catch-all rewrite, so missing assets and unknown paths return a real 404.

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
