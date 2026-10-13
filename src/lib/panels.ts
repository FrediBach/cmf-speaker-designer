import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { applyFaceDepth, MAX_FACE_DEPTH } from './face-depth'
import { computePanelNormals } from './panel-normals'
import type { HaloSettings } from './halo-settings'
export { MAX_FACE_DEPTH } from './face-depth'

import sOriginal from '../../resources/stl-files/cmf-speaker-s-3d-printing-panel-original-v1.stl?url'
import mOriginal from '../../resources/stl-files/cmf-speaker-m-3d-printing-panel-original-v1.stl?url'

export type SpeakerModel = 's' | 'm'
export type PanelStyle = 'original' | 'custom'

export interface PanelStyleOption {
  id: PanelStyle
  label: string
  description: string
}

export const SPEAKER_MODELS = [
  {
    id: 's',
    label: 'Speaker S',
    width: 84.9715,
    height: 130.9691,
    baseDepth: 24,
  },
  {
    id: 'm',
    label: 'Speaker M',
    width: 84.9715,
    height: 224.9691,
    baseDepth: 29,
  },
] as const

export const PANEL_STYLES: readonly PanelStyleOption[] = [
  {
    id: 'original',
    label: 'Original',
    description: 'The original open speaker face.',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Shape your panel in the Halo and Grille tabs.',
  },
]

export const PANEL_ASSETS: Record<SpeakerModel, Record<PanelStyle, string>> = {
  s: { original: sOriginal, custom: sOriginal },
  m: { original: mOriginal, custom: mOriginal },
}

/** Both models use the original face as the starting point for custom geometry. */
export function getPanelStyles(
  _model: SpeakerModel,
): readonly PanelStyleOption[] {
  return PANEL_STYLES
}

/**
 * A rigid transform only: millimeters stay millimeters. Display X is width, Y is
 * upright, and +Z points out of the speaker. The main face's rear rim is Z=0;
 * the folded control plate extends behind it. No source features are scaled.
 */
export function parsePanelGeometry(
  data: ArrayBuffer,
  model: SpeakerModel,
): BufferGeometry {
  const geometry = new STLLoader().parse(data)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const center = box.getCenter(new Vector3())
  const front = box.min.x + (model === 's' ? 24 : 29)
  const mountingPlane = front - 4

  // Rotation about Y is right handed, retaining the original triangle winding.
  geometry.translate(-mountingPlane, -center.y, -center.z)
  geometry.rotateY(-Math.PI / 2)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** Returns an owned geometry. The caller should dispose it when replaced. */
export async function loadPanelGeometry(
  model: SpeakerModel,
  style: PanelStyle,
  signal?: AbortSignal,
): Promise<BufferGeometry> {
  const response = await fetch(PANEL_ASSETS[model][style], { signal })
  if (!response.ok)
    throw new Error(`Unable to load the panel (${response.status}).`)
  return parsePanelGeometry(await response.arrayBuffer(), model)
}

/**
 * Add material ahead of the main face's inner surface, preserving every vertex
 * at or behind Z=.5 mm and the folded controls. A continuous, monotonic depth
 * map retains connectivity, openings, XY dimensions, and the attachment fit.
 * Refine the depth transition before deforming so broad triangles stay planar.
 * This changes face depth, not the speaker's acoustic or mechanical design.
 */
export function buildPanelGeometry(
  source: BufferGeometry,
  model: SpeakerModel,
  style: PanelStyle,
  relief = 0,
): BufferGeometry {
  if (!Number.isFinite(relief) || relief < 0 || relief > MAX_FACE_DEPTH) {
    throw new RangeError(
      `Added face depth must be between 0 and ${MAX_FACE_DEPTH} mm.`,
    )
  }

  const geometry = source.clone()
  geometry.userData = { model, style, addedFaceDepth: relief, units: 'mm' }
  if (relief > 0) {
    const positions = applyFaceDepth(
      new Float32Array(source.getAttribute('position').array),
      model,
      relief,
    )
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  }
  // STL triangles have separate vertices. Blend their normals across curves,
  // keeping the control fold and other sharp edges crisp without moving vertices.
  computePanelNormals(geometry)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function getPanelDimensions(geometry: BufferGeometry) {
  geometry.computeBoundingBox()
  const size = geometry.boundingBox!.getSize(new Vector3())
  return { width: size.x, height: size.y, depth: size.z }
}

/**
 * Binary STL contains only the panel, with the front toward the print bed.
 * The lowest point is Z=0; distances remain in mm. Slicer orientation, supports,
 * tolerances, and material still need checking for the selected printer.
 */
export function exportPanelStl(geometry: BufferGeometry): ArrayBuffer {
  const printable = geometry.clone()
  printable.rotateY(Math.PI)
  printable.computeBoundingBox()
  printable.translate(0, 0, -printable.boundingBox!.min.z)
  const mesh = new Mesh(printable)
  mesh.updateMatrixWorld(true)
  const binary = new STLExporter().parse(mesh, { binary: true })
  const result = new ArrayBuffer(binary.byteLength)
  new Uint8Array(result).set(
    new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength),
  )
  printable.dispose()
  return result
}

export function panelFilename(
  model: SpeakerModel,
  _style: PanelStyle,
  addedDepth = 0,
): string {
  const suffix = addedDepth > 0 ? `-depth-${addedDepth.toFixed(1)}mm` : ''
  return `cmf-speaker-${model}-original${suffix}.stl`
}

export function haloFilenameSuffix(settings?: HaloSettings): string {
  if (settings?.mode !== 'custom') return ''
  return `-halo-${settings.depth.toFixed(1)}mm${settings.cutAngle > 0 ? `-cut-${settings.cutAngle.toFixed(1)}deg` : ''}`
}

export function downloadPanelStl(
  geometry: BufferGeometry,
  model: SpeakerModel,
  style: PanelStyle,
  addedDepth = 0,
): void {
  const url = URL.createObjectURL(
    new Blob([exportPanelStl(geometry)], { type: 'model/stl' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  const customHandle = geometry.userData.handle?.settings?.mode === 'custom'
  const grille = geometry.userData.grille?.settings
  const handleSuffix = customHandle
    ? `-handle-${Number(geometry.userData.handle.settings.height).toFixed(1)}mm`
    : ''
  const grilleSuffix =
    grille?.mode === 'custom'
      ? `-grille-${grille.pattern}${grille.extendPattern ? '-extended' : ''}`
      : ''
  anchor.download = panelFilename(model, style, addedDepth).replace(
    '.stl',
    `${handleSuffix}${grilleSuffix}${haloFilenameSuffix(geometry.userData.halo?.settings)}.stl`,
  )
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Keep the URL alive until the browser has accepted the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
