import { buildArchive } from './archive'
import type { BufferGeometry } from 'three'
import type { Design } from './design'
import { exportKnobStl, knobFilename, prepareKnobExportGeometry } from './knobs'
import {
  exportPanelStl,
  haloFilenameSuffix,
  handleFilenameSuffix,
  panelFilename,
  preparePanelExportGeometry,
} from './panels'
import { exportStepFile } from './step-export-client'
import { STEP_TOLERANCE_MM } from './step-settings'
import {
  patternGeometryKey,
  type MaterialGeometry,
} from './multicolor-geometry'
import {
  exportThreeMf,
  panelAssemblyTransform,
  serializePlacedStl,
  type ThreeMfAssembly,
  type ThreeMfPart,
} from './three-mf-export'

const encoder = new TextEncoder()

export type DesignExportTarget = 'both' | 'panel' | 'knob'
export type DesignExportFormat = 'stl' | 'stp' | '3mf' | 'stl-parts'

export interface DesignExportInput {
  panel: BufferGeometry
  knob: BufferGeometry
  design: Design
  target: DesignExportTarget
  format?: DesignExportFormat
  materialParts?: MaterialGeometry[] | null
}

export interface DesignExportFile {
  filename: string
  data: ArrayBuffer
  mimeType: 'model/stl' | 'model/step' | 'model/3mf' | 'application/zip'
}

function selectedPanelFilename(design: Design): string {
  const handleSuffix = handleFilenameSuffix(design.handle)
  const grilleSuffix =
    design.grille.mode === 'custom'
      ? `-grille-${design.grille.pattern}${design.grille.extendPattern ? '-extended' : ''}`
      : ''
  const stripeSuffix = design.raceStripes.enabled
    ? `-race-stripes-${design.raceStripes.count}x${design.raceStripes.width.toFixed(1)}mm${design.raceStripes.count > 1 ? `-gap-${design.raceStripes.gap.toFixed(1)}mm` : ''}`
    : ''
  return panelFilename(
    design.model,
    'original',
    design.relief,
    design.panelExtension,
    design.panelGap,
  ).replace(
    '.stl',
    `${handleSuffix}${grilleSuffix}${haloFilenameSuffix(design.halo)}${stripeSuffix}.stl`,
  )
}

/** Exports separate printable parts, preparing CAD geometry only for STEP. */
export async function buildDesignExport({
  panel,
  knob,
  design,
  target,
  format = 'stl',
  materialParts,
}: DesignExportInput): Promise<DesignExportFile> {
  if (format === '3mf' || format === 'stl-parts')
    return buildMaterialExport({
      panel,
      knob,
      design,
      target,
      format,
      materialParts,
    })
  const panelName = selectedPanelFilename(design).replace(
    /\.stl$/,
    `.${format}`,
  )
  const knobName = knobFilename(design.knob).replace(/\.stl$/, `.${format}`)
  const mimeType = format === 'stp' ? 'model/step' : 'model/stl'
  const serialize = async (
    geometry: BufferGeometry,
    part: 'panel' | 'knob',
    name: string,
  ) => {
    if (format === 'stl')
      return part === 'panel'
        ? exportPanelStl(geometry)
        : exportKnobStl(geometry)
    const printable =
      part === 'panel'
        ? preparePanelExportGeometry(geometry)
        : prepareKnobExportGeometry(geometry)
    try {
      return await exportStepFile(printable, name)
    } finally {
      printable.dispose()
    }
  }
  if (target === 'panel') {
    return {
      filename: panelName,
      data: await serialize(panel, 'panel', panelName),
      mimeType,
    }
  }
  if (target === 'knob') {
    return {
      filename: knobName,
      data: await serialize(knob, 'knob', knobName),
      mimeType,
    }
  }

  const settings = {
    ...design,
    export: {
      version: 1,
      units: 'mm',
      format,
      geometryType: format === 'stp' ? 'advanced-brep' : 'mesh',
      ...(format === 'stp' ? { toleranceMm: STEP_TOLERANCE_MM } : {}),
      files: { panel: panelName, knob: knobName },
      colorNote: `${format.toUpperCase()} files contain geometry only. Match panelColor and knobColor to filament or material colors in your slicer or CAD application. bodyColor identifies the existing speaker body, which is preview context only.`,
    },
  }
  return {
    filename: `cmf-speaker-${design.model}-design${format === 'stp' ? '-stp' : ''}.zip`,
    data: buildArchive([
      {
        name: panelName,
        data: new Uint8Array(await serialize(panel, 'panel', panelName)),
      },
      {
        name: knobName,
        data: new Uint8Array(await serialize(knob, 'knob', knobName)),
      },
      {
        name: 'design.json',
        data: encoder.encode(`${JSON.stringify(settings, null, 2)}\n`),
      },
    ]),
    mimeType: 'application/zip',
  }
}

function buildMaterialExport({
  panel,
  knob,
  design,
  target,
  format,
  materialParts,
}: DesignExportInput): DesignExportFile {
  const owned: BufferGeometry[] = []
  const own = (geometry: BufferGeometry) => {
    owned.push(geometry)
    return geometry
  }
  try {
    const assemblies: ThreeMfAssembly[] = []
    let printablePanel: BufferGeometry | undefined
    if (target !== 'knob') {
      const transform = panelAssemblyTransform(panel)
      printablePanel = own(panel.clone().applyMatrix4(transform))
      printablePanel.computeBoundingBox()
      let parts: ThreeMfPart[]
      if (design.multicolor.enabled) {
        if (!materialParts?.length)
          throw new Error(
            'Wait for the current multicolor regions before exporting.',
          )
        const key = patternGeometryKey(design.multicolor)
        if (
          materialParts.some(
            ({ geometry }) =>
              geometry.userData.multicolorKey !== key ||
              geometry.userData.multicolorSourceUuid !== panel.uuid,
          )
        )
          throw new Error(
            'The multicolor regions are out of date. Wait for the current design to finish.',
          )
        parts = materialParts.map((part) => {
          const material =
            part.materialId === 'base'
              ? { name: 'Background', color: design.panelColor }
              : design.multicolor.materials.find(
                  (item) => item.id === part.materialId,
                )
          if (!material)
            throw new Error(
              'The material regions no longer match the current palette. Please regenerate.',
            )
          return {
            id: part.materialId,
            name: material.name,
            color: material.color,
            geometry: own(part.geometry.clone().applyMatrix4(transform)),
          }
        })
      } else {
        parts = [
          {
            id: 'base',
            name: 'Front panel',
            color: design.panelColor,
            geometry: printablePanel,
          },
        ]
      }
      assemblies.push({
        name: `Speaker ${design.model.toUpperCase()} panel`,
        parts,
      })
    }
    if (target !== 'panel') {
      const printableKnob = own(prepareKnobExportGeometry(knob))
      if (printablePanel) {
        printableKnob.computeBoundingBox()
        printableKnob.translate(
          printablePanel.boundingBox!.max.x +
            10 -
            printableKnob.boundingBox!.min.x,
          printablePanel.boundingBox!.min.y - printableKnob.boundingBox!.min.y,
          0,
        )
      }
      assemblies.push({
        name: 'Volume knob',
        parts: [
          {
            id: 'knob',
            name: 'Volume knob',
            color: design.knobColor,
            geometry: printableKnob,
          },
        ],
      })
    }
    const metadata = {
      ...design,
      export: {
        version: 2,
        units: 'mm',
        format,
        geometryType: 'material-volumes',
        mapping: 'front-projection',
        depthMode: 'full-depth',
        colorNote:
          'Assign and confirm filament for each named material part in your slicer. Keep panel parts assembled; do not center or ground them separately.',
      },
    }
    if (format === '3mf')
      return {
        filename: `cmf-speaker-${design.model}-${target === 'both' ? 'design' : target}.3mf`,
        mimeType: 'model/3mf',
        data: exportThreeMf(assemblies, metadata),
      }
    const entries: { name: string; data: Uint8Array }[] = []
    const manifest: {
      materialId: string
      name: string
      color: string
      file: string
      assembly: string
    }[] = []
    for (const assembly of assemblies)
      for (const [index, part] of assembly.parts.entries()) {
        const slug =
          part.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40) || 'material'
        const name =
          assembly.name === 'Volume knob'
            ? 'volume-knob.stl'
            : `panel-material-${String(index + 1).padStart(2, '0')}-${slug}.stl`
        entries.push({
          name,
          data: new Uint8Array(serializePlacedStl(part.geometry)),
        })
        manifest.push({
          materialId: part.id,
          name: part.name,
          color: part.color,
          file: name,
          assembly: assembly.name,
        })
      }
    entries.push({
      name: 'design.json',
      data: encoder.encode(
        `${JSON.stringify({ ...metadata, export: { ...metadata.export, files: manifest } }, null, 2)}\n`,
      ),
    })
    entries.push({
      name: 'materials.json',
      data: encoder.encode(
        `${JSON.stringify({ units: 'mm', parts: manifest }, null, 2)}\n`,
      ),
    })
    entries.push({
      name: 'README.txt',
      data: encoder.encode(
        'CMF Speaker Designer — multicolor parts\n\nImport all panel-material STLs together as PARTS OF ONE OBJECT at 100% scale in millimeters. Preserve their common positions; do not auto-arrange, center, or drop each part independently. Assign a filament to each named material, using materials.json as your color guide. The volume knob is a separate object.\n\nThese are full-depth material regions of one assembled print, not separately printable inlays. Review sliced layers, supports, interfaces, and filament compatibility. Reopen the authored composition using Load design JSON in the designer.\n',
      ),
    })
    return {
      filename: `cmf-speaker-${design.model}-${target}-materials.zip`,
      mimeType: 'application/zip',
      data: buildArchive(entries),
    }
  } finally {
    owned.forEach((geometry) => geometry.dispose())
  }
}

export async function downloadDesignExport(
  input: DesignExportInput,
): Promise<void> {
  const file = await buildDesignExport(input)
  const url = URL.createObjectURL(
    new Blob([file.data], { type: file.mimeType }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
