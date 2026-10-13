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

The tests start Vite automatically when needed and cover the WebGL preview, model and style changes, saved colors, keyboard face-depth controls, the actual STL download, and a narrow mobile layout. Screenshots and failure traces are written to the ignored `test-results/` directory.

## What the POC does

- Switch between Speaker S and M.
- Choose from the original front panel and the three supplied alternate designs.
- Preview front panel and volume knob colors in an interactive Three.js scene, including panel-only and exploded views.
- Add up to 2 mm of face depth while retaining the original mounting region and overall face dimensions.
- Keep your current design locally and copy a link to share a configuration.
- Download the selected panel as a binary STL in millimeters.

The designer uses the supplied meshes rather than generating approximate replacements. STL has no color or unit metadata: the exported coordinates are intended as millimeters, and color is a preview setting. Choose the corresponding filament or material in your slicer. This POC does not include freeform drawing, text embossing, slicer integration, or multi-material exports.

## Source models and printing

The original assets live in `resources/product-images/` and `resources/stl-files/`. Background and source information is available in the [Nothing Community announcement](https://nothing.community/d/63517-3d-print-your-own-cmf-speaker).

The selectable meshes are the `panel-original`, `panel-1`, `panel-2`, and `panel-3` files for each model. The combined `panel-merge` files and separate knobs/buttons remain available in the repository but are not exported by the designer.

Dimensions are retained from the source files, approximately 85 × 131 mm for S and 85 × 225 mm for M. Added depth affects the front surface; the attachment region and folded control plate stay unchanged. Downloads orient the front toward the print bed and place the lowest point at Z=0, with coordinates expressed in millimeters. Import at 100% scale and check orientation, supports, and material settings in your slicer before printing.

The automated checks validate mesh topology, preserved mounting coordinates, and STL serialization. Physical fit, printer tolerances, strength, and acoustic performance still need validation with test prints on the actual speakers. The speaker body shown in the preview is an approximate context model; only the selected front panel is included in the download.

## Implementation

- **Vite, React, and TypeScript** provide the application shell and production build.
- **shadcn/ui components, Radix UI, and Tailwind CSS** provide buttons, the face-depth slider, and accessible dialogs, with custom product-inspired styling.
- **Three.js, React Three Fiber, and Drei** provide mesh loading, material previews, lighting, and camera interaction.
- `src/lib/panels.ts` owns source selection, model coordinates, face-depth transformations, and STL exports.
- `src/lib/design.ts` validates shared and locally stored design settings.
- `src/components/SpeakerPreview.tsx` renders the selected panel and the contextual speaker body.
- `src/App.tsx` connects the controls, preview, and download workflow.

Models are loaded on demand. Large STL resources are part of the deployable assets, so a first model load can take a moment. No backend, account, or API key is required; geometry processing and export run in the browser.

## Deploy to cmfspeakerdesigner.com

Run `npm ci` followed by `npm run build`, then deploy the contents of `dist/` to a static web host. Configure that host's custom domain as `cmfspeakerdesigner.com`, follow its DNS instructions, and enable HTTPS. The current Vite configuration targets the domain root.

Serve all generated assets, including the STL files, and enable HTTP compression and caching through the host. The repository does not provision hosting or change DNS.

Application code is covered by the repository's [MIT license](LICENSE). The supplied product photography and model files retain their respective owners' rights.
