# CMF Speaker Designer

A browser-based front panel designer for CMF Speaker S and M, built as a proof of concept for **cmfspeakerdesigner.com**. The interface takes its warm white, orange, dark grey, and technical typography from the supplied product photography.

## Run locally

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Other commands:

```sh
npm run check    # TypeScript validation
npm test         # Geometry and STL export checks
npm run build    # Production files in dist/
npm run preview  # Serve the production build locally
```

Browser regression checks use Playwright with a locally installed Google Chrome:

```sh
npm run test:e2e
```

The tests start Vite automatically when needed and cover the WebGL preview, model and style changes, saved colors, keyboard face-depth controls, generated handles and grilles, actual STL downloads, and a narrow mobile layout. Downloads are inspected independently for closed edges, one connected component, hole topology, clear passages through each opening, and solid backing behind face recesses. Screenshots, downloaded STLs, and failure traces are written to the ignored `test-results/` directory.

To check the bundled geometry worker and WebAssembly module against a production build:

```sh
npm run build
PLAYWRIGHT_PREVIEW=1 npm run test:e2e -- --grep "generates a"
```

Development tests use port 5174; production-preview tests use port 4179. Development tests reuse an existing server; production tests start an isolated preview and fail if that port is occupied.

## What the POC does

- Switch between Speaker S and M.
- Choose from the original front panel and the three supplied alternate designs.
- Generate round, hexagonal, or slotted grilles with adjustable opening size, material spacing, arrangement, rotation, and thickness.
- Continue the grille pattern onto the surrounding front face as shallow recesses, with solid material behind them.
- Preview front panel and volume knob colors in an interactive Three.js scene, including panel-only and exploded views.
- Add up to 2 mm of face depth while retaining the original mounting region and overall face dimensions.
- Generate a custom upper handle: adjust its height, width, and rounded corners, then choose a solid face or one to three circular or slotted openings.
- Change hole size, spacing, and position, with dependent dimensions constrained to leave at least 3 mm of surrounding material.
- Keep your current design locally and copy a link to share a configuration.
- Download the selected panel as a binary STL in millimeters.

The designer starts from the supplied front panel meshes. The **Original handle** option retains the source upper section. **Custom handle** removes that upper section above the control deck and joins a newly generated extension to the remaining panel; its openings are actual through-holes in the exported solid. Carry loop, Three dots, and Solid presets provide starting points. STL has no color or unit metadata: the exported coordinates are intended as millimeters, and color is a preview setting. Choose the corresponding filament or material in your slicer. This POC does not include freeform drawing, text embossing, slicer integration, or multi-material exports.

The **Grille** tab generates a perforated grille over the original driver openings: one on S and both on M. Custom grilles use the original open panel as their base and can be combined with a custom handle and added face depth. Selecting **Original grille** restores the selected supplied panel style. Selecting a supplied front-panel shape also turns off the generated grille while retaining its settings.

**Continue across the face** adds matching blind recesses outside the driver openings. These are real surface geometry in the STL, not a texture or additional through-holes. The surrounding rim, outside edges, control deck, and mounting regions are preserved. Preview and export share the same generated mesh, and grille dimensions are applied after added face depth so their selected thickness and recess depth stay in millimeters.

## Source models and printing

The original assets live in `resources/product-images/` and `resources/stl-files/`. Background and source information is available in the [Nothing Community announcement](https://nothing.community/d/63517-3d-print-your-own-cmf-speaker).

The selectable meshes are the `panel-original`, `panel-1`, `panel-2`, and `panel-3` files for each model. The combined `panel-merge` files and separate knobs/buttons remain available in the repository but are not exported by the designer.

The original panels measure approximately 85 × 131 mm for S and 85 × 225 mm for M. Added face depth affects the front surface; the attachment region and folded control plate stay unchanged. A custom handle changes the overall panel bounds, shown in the preview and download summary. It is 4 mm thick, with an extension height of 16–70 mm and width of 60–110 mm. Corner radius, hole sizes, and offsets are limited together to retain the connecting shoulder and minimum wall thickness.

The generated upper section is joined with a Boolean union into one connected solid above the preserved control deck. Boolean operations can retessellate the original lower mesh; the generator uses a 0.00005 mm simplification tolerance to resolve numerical slivers. Downloads orient the front toward the print bed and place the lowest point at Z=0, with coordinates expressed in millimeters. Import at 100% scale and check orientation, supports, and material settings in your slicer before printing.

The automated checks validate mesh topology, attachment geometry, actual openings, solid backing behind decorative recesses, and STL serialization. Physical fit, printer tolerances, carrying strength, and acoustic performance still need validation with test prints on the actual speakers. The 3 mm handle material constraint is a geometry limit, not a load rating. The speaker body shown in the preview is an approximate context model; only the selected front panel and its integrated handle and grille are included in the download.

## Implementation

- **Vite, React, and TypeScript** provide the application shell and production build.
- **shadcn/ui components, Radix UI, and Tailwind CSS** provide buttons, the face-depth slider, and accessible dialogs, with custom product-inspired styling.
- **Three.js, React Three Fiber, and Drei** provide mesh loading, material previews, lighting, and camera interaction.
- **Manifold** performs solid Boolean operations in a WebAssembly worker, keeping handle and grille generation off the main UI thread.
- `src/lib/panels.ts` owns source selection, model coordinates, face-depth transformations, and STL exports.
- `src/lib/handle-settings.ts` validates dependent handle dimensions and material constraints.
- `src/lib/handle-geometry.ts` trims the source upper section and generates a connected handle with real cutouts; `handles.worker.ts` runs this kernel in the browser.
- `src/lib/grille-settings.ts` constrains grille dimensions and defines the shared pattern layout; `grille-geometry.ts` joins perforated inserts and cuts blind decorative recesses.
- `src/lib/panel-engine.ts` combines handle generation, the shared face-depth transformation, and grille generation in order inside the worker.
- `src/lib/use-panel-geometry.ts` schedules geometry updates, retains the last preview during generation, and enables export when the current design is ready.
- `src/lib/design.ts` validates shared and locally stored design settings.
- `src/components/SpeakerPreview.tsx` renders the selected panel and the contextual speaker body.
- `src/App.tsx` connects the controls, preview, and download workflow.

Models and the geometry generator are loaded on demand. Large STL resources and the WebAssembly module are part of the deployable assets, so a first load can take a moment. No backend, account, or API key is required; geometry processing and export run in the browser. Existing saved designs and shared links without handle or grille settings continue to open with the original source geometry.

## Deploy to cmfspeakerdesigner.com

Run `npm ci` followed by `npm run build`, then deploy the contents of `dist/` to a static web host. Configure that host's custom domain as `cmfspeakerdesigner.com`, follow its DNS instructions, and enable HTTPS. The current Vite configuration targets the domain root.

Serve all generated assets, including the STL files, worker script, and `.wasm` module, and enable HTTP compression and caching through the host. The repository does not provision hosting or change DNS.

Application code is covered by the repository's [MIT license](LICENSE). The supplied product photography and model files retain their respective owners' rights.
