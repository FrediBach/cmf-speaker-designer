import { buildArchive } from './archive'
import { BufferAttribute, BufferGeometry } from 'three'
import type { Design } from './design'
import type { PanelSplitMetadata } from './panel-split'
import { buildMulticolorGeometry } from './multicolor-client'
import { exportKnobStl, knobFilename, prepareKnobExportGeometry } from './knobs'
import {
  exportPowerButtonStl,
  powerButtonFilename,
  preparePowerButtonExportGeometry,
} from './power-button'
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

export type DesignExportTarget = 'all' | 'panel' | 'knob' | 'power-button'
export type DesignExportFormat = 'stl' | 'stp' | '3mf' | 'stl-parts'

export interface DesignExportInput {
  panel: BufferGeometry
  knob: BufferGeometry
  powerButton: BufferGeometry
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

/** Read typed split buffers before cloning: Three serializes cloned userData. */
function splitPanelGeometries(panel: BufferGeometry) {
  const split = panel.userData.split as PanelSplitMetadata | undefined
  if (!split?.frontPositions?.length || !split?.upperPositions?.length)
    throw new Error('Wait for the split panel to finish before exporting.')
  return (['front', 'upper'] as const).map((id) => {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(split[`${id}Positions`]), 3),
    )
    return { id, geometry }
  })
}

function splitPanelExportMetadata(panel: BufferGeometry) {
  const split = panel.userData.split as PanelSplitMetadata
  return {
    seamY: split.seamY,
    seamGapMm: split.seamGapMm,
    clearanceMm: split.clearanceMm,
    engagementMm: split.engagementMm,
    tongueWidthMm: split.tongueWidthMm,
    tongueThicknessMm: split.tongueThicknessMm,
    insertionAxis: split.insertionAxis,
    assemblyNote:
      'Print the front and upper panel separately. Slide the upper tongue down into the groove in the front panel before mounting the panel on the speaker.',
  }
}

async function buildSplitPanelExport(
  input: DesignExportInput & { format: 'stl' | 'stp' },
): Promise<DesignExportFile> {
  const { panel, design, target, format } = input
  const parts = splitPanelGeometries(panel)
  const filenames = {
    front: selectedPanelFilename(design).replace(
      '.stl',
      `-split-front.${format}`,
    ),
    upper: selectedPanelFilename(design).replace(
      '.stl',
      `-split-upper.${format}`,
    ),
  }
  const entries: { name: string; data: Uint8Array }[] = []
  try {
    for (const { id, geometry } of parts) {
      geometry.applyMatrix4(panelAssemblyTransform(geometry, id))
      entries.push({
        name: filenames[id],
        data: new Uint8Array(
          format === 'stp'
            ? await exportStepFile(geometry, filenames[id])
            : serializePlacedStl(geometry),
        ),
      })
    }
    const files: Record<string, string | typeof filenames> = {
      panel: filenames,
    }
    if (target === 'all') {
      for (const part of ['knob', 'power-button'] as const) {
        const file = await buildDesignExport({ ...input, target: part })
        entries.push({ name: file.filename, data: new Uint8Array(file.data) })
        files[part === 'knob' ? 'knob' : 'powerButton'] = file.filename
      }
    }
    entries.push({
      name: 'design.json',
      data: encoder.encode(
        `${JSON.stringify(
          {
            ...design,
            export: {
              version: 2,
              units: 'mm',
              format,
              geometryType: format === 'stp' ? 'advanced-brep' : 'mesh',
              ...(format === 'stp' ? { toleranceMm: STEP_TOLERANCE_MM } : {}),
              files,
              panelSplit: splitPanelExportMetadata(panel),
              colorNote: `${format.toUpperCase()} files contain geometry only. Match the saved colors to filament or material colors in your slicer or CAD application.`,
            },
          },
          null,
          2,
        )}\n`,
      ),
    })
    return {
      filename: `cmf-speaker-${design.model}-${target === 'all' ? 'design' : 'panel'}-split${format === 'stp' ? '-stp' : ''}.zip`,
      data: buildArchive(entries),
      mimeType: 'application/zip',
    }
  } finally {
    parts.forEach(({ geometry }) => geometry.dispose())
  }
}

/** Exports separate printable parts, preparing CAD geometry only for STEP. */
export async function buildDesignExport({
  panel,
  knob,
  powerButton,
  design,
  target,
  format = 'stl',
  materialParts,
}: DesignExportInput): Promise<DesignExportFile> {
  if (format === '3mf' || format === 'stl-parts')
    return buildMaterialExport({
      panel,
      knob,
      powerButton,
      design,
      target,
      format,
      materialParts,
    })
  if (design.panelSplit && (target === 'all' || target === 'panel'))
    return buildSplitPanelExport({
      panel,
      knob,
      powerButton,
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
  const powerButtonName = powerButtonFilename().replace(/\.stl$/, `.${format}`)
  const mimeType = format === 'stp' ? 'model/step' : 'model/stl'
  const serialize = async (
    geometry: BufferGeometry,
    part: Exclude<DesignExportTarget, 'all'>,
    name: string,
  ) => {
    if (format === 'stl')
      return part === 'panel'
        ? exportPanelStl(geometry)
        : part === 'knob'
          ? exportKnobStl(geometry)
          : exportPowerButtonStl(geometry)
    const printable =
      part === 'panel'
        ? preparePanelExportGeometry(geometry)
        : part === 'knob'
          ? prepareKnobExportGeometry(geometry)
          : preparePowerButtonExportGeometry(geometry)
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
  if (target === 'power-button') {
    return {
      filename: powerButtonName,
      data: await serialize(powerButton, 'power-button', powerButtonName),
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
      files: { panel: panelName, knob: knobName, powerButton: powerButtonName },
      colorNote: `${format.toUpperCase()} files contain geometry only. Match panelColor, knobColor, and powerButtonColor to filament or material colors in your slicer or CAD application. bodyColor and bodyGrilleColor identify the existing speaker body and grille, which are preview context only.`,
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
        name: powerButtonName,
        data: new Uint8Array(
          await serialize(powerButton, 'power-button', powerButtonName),
        ),
      },
      {
        name: 'design.json',
        data: encoder.encode(`${JSON.stringify(settings, null, 2)}\n`),
      },
    ]),
    mimeType: 'application/zip',
  }
}

async function buildMaterialExport({
  panel,
  knob,
  powerButton,
  design,
  target,
  format,
  materialParts,
}: DesignExportInput): Promise<DesignExportFile> {
  const owned: BufferGeometry[] = []
  const own = (geometry: BufferGeometry) => {
    owned.push(geometry)
    return geometry
  }
  try {
    const assemblies: ThreeMfAssembly[] = []
    const splitPanel =
      design.panelSplit && (target === 'all' || target === 'panel')
    let precedingPart: BufferGeometry | undefined
    const placeNextPart = (geometry: BufferGeometry) => {
      geometry.computeBoundingBox()
      const offset = precedingPart
        ? [
            precedingPart.boundingBox!.max.x + 10 - geometry.boundingBox!.min.x,
            precedingPart.boundingBox!.min.y - geometry.boundingBox!.min.y,
          ]
        : [0, 0]
      geometry.translate(offset[0], offset[1], 0)
      precedingPart = geometry
      return offset
    }
    if (target === 'all' || target === 'panel') {
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
      }
      const panelPieces = design.panelSplit
        ? splitPanelGeometries(panel).map((piece) => ({
            ...piece,
            geometry: own(piece.geometry),
          }))
        : [{ id: 'front' as const, geometry: panel }]
      const taggedRegions =
        design.multicolor.enabled &&
        design.panelSplit &&
        materialParts!.some(({ panelPart }) => panelPart !== undefined)
      if (
        taggedRegions &&
        (materialParts!.some(
          ({ panelPart }) => panelPart !== 'front' && panelPart !== 'upper',
        ) ||
          panelPieces.some(
            ({ id }) =>
              !materialParts!.some(({ panelPart }) => panelPart === id),
          ))
      )
        throw new Error(
          'The split material regions are incomplete. Wait for the current design to finish.',
        )
      for (const piece of panelPieces) {
        const transform = panelAssemblyTransform(piece.geometry, piece.id)
        const printablePanel = own(
          piece.geometry.clone().applyMatrix4(transform),
        )
        const [offsetX, offsetY] = placeNextPart(printablePanel)
        let regions = materialParts
        if (taggedRegions) {
          regions = materialParts!.filter(
            ({ panelPart }) => panelPart === piece.id,
          )
        } else if (design.multicolor.enabled && design.panelSplit) {
          // Partition the exact physical solid, including the tongue/groove.
          // A plane cut of the combined color mesh would put the tongue into
          // the front object and could leave either physical part open.
          const generated = await buildMulticolorGeometry(
            piece.geometry,
            design.multicolor,
          )
          regions = generated.parts
          for (const region of regions) {
            own(region.geometry)
            if (region.previewGeometry) own(region.previewGeometry)
          }
        }
        const name = design.panelSplit
          ? `${piece.id === 'front' ? 'Front' : 'Upper'} panel`
          : 'Front panel'
        const parts: ThreeMfPart[] = design.multicolor.enabled
          ? regions!.map((part) => {
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
                geometry: own(
                  part.geometry
                    .clone()
                    .applyMatrix4(transform)
                    .translate(offsetX, offsetY, 0),
                ),
              }
            })
          : [
              {
                id: 'base',
                name,
                color: design.panelColor,
                geometry: printablePanel,
              },
            ]
        assemblies.push({
          name: `Speaker ${design.model.toUpperCase()} ${design.panelSplit ? `${piece.id} panel` : 'panel'}`,
          parts,
        })
      }
    }
    if (target === 'all' || target === 'knob') {
      const printableKnob = own(prepareKnobExportGeometry(knob))
      placeNextPart(printableKnob)
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
    if (target === 'all' || target === 'power-button') {
      const printablePowerButton = own(
        preparePowerButtonExportGeometry(powerButton),
      )
      placeNextPart(printablePowerButton)
      assemblies.push({
        name: 'Power button',
        parts: [
          {
            id: 'power-button',
            name: 'Power button',
            color: design.powerButtonColor,
            geometry: printablePowerButton,
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
        ...(splitPanel ? { panelSplit: splitPanelExportMetadata(panel) } : {}),
        colorNote: splitPanel
          ? 'Print the front and upper panel as separate objects. Keep the color regions within each object assembled; do not center or ground individual color regions. Slide the upper tongue down into the groove in the front panel before mounting.'
          : 'Assign and confirm filament for each named material part in your slicer. Keep panel parts assembled; do not center or ground them separately.',
      },
    }
    if (format === '3mf')
      return {
        filename: `cmf-speaker-${design.model}-${target === 'all' ? 'design' : target}.3mf`,
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
            : assembly.name === 'Power button'
              ? 'power-button.stl'
              : `${design.panelSplit ? (assembly.name.endsWith('front panel') ? 'panel-front' : 'panel-upper') : 'panel'}-material-${String(index + 1).padStart(2, '0')}-${slug}.stl`
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
        splitPanel
          ? 'CMF Speaker Designer — split panel multicolor parts\n\nImport all panel-front-material STLs together as PARTS OF ONE OBJECT, then import all panel-upper-material STLs as PARTS OF A SECOND OBJECT, at 100% scale in millimeters. Each group is one physical print. Preserve the common positions within each group; do not center or ground individual color regions. The volume knob and power button are separate objects.\n\nAssign a filament to each named material using materials.json. Slide the upper tongue down into the groove in the printed front panel before mounting. Review supports and test-fit your first print. Reopen the authored composition using Load design JSON in the designer.\n'
          : 'CMF Speaker Designer — multicolor parts\n\nImport all panel-material STLs together as PARTS OF ONE OBJECT at 100% scale in millimeters. Preserve their common positions; do not auto-arrange, center, or drop each part independently. Assign a filament to each named material, using materials.json as your color guide. The volume knob and power button are separate objects.\n\nThese are full-depth material regions of one assembled print, not separately printable inlays. Review sliced layers, supports, interfaces, and filament compatibility. Reopen the authored composition using Load design JSON in the designer.\n',
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
