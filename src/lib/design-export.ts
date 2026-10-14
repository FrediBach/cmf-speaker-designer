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

export type DesignExportTarget = 'both' | 'panel' | 'knob'
export type DesignExportFormat = 'stl' | 'stp'

export interface DesignExportInput {
  panel: BufferGeometry
  knob: BufferGeometry
  design: Design
  target: DesignExportTarget
  format?: DesignExportFormat
}

export interface DesignExportFile {
  filename: string
  data: ArrayBuffer
  mimeType: 'model/stl' | 'model/step' | 'application/zip'
}

interface ArchiveEntry {
  name: string
  data: Uint8Array
}

const encoder = new TextEncoder()
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})

function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Stored ZIP entries keep this small, browser-native export dependency-free. */
function buildArchive(entries: ArchiveEntry[]): ArrayBuffer {
  const files = entries.map((entry) => ({
    ...entry,
    nameBytes: encoder.encode(entry.name),
    checksum: crc32(entry.data),
  }))
  const directoryOffset = files.reduce(
    (size, file) => size + 30 + file.nameBytes.length + file.data.length,
    0,
  )
  const directorySize = files.reduce(
    (size, file) => size + 46 + file.nameBytes.length,
    0,
  )
  const buffer = new ArrayBuffer(directoryOffset + directorySize + 22)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let localOffset = 0
  let centralOffset = directoryOffset

  for (const file of files) {
    view.setUint32(localOffset, 0x04034b50, true)
    view.setUint16(localOffset + 4, 20, true)
    view.setUint16(localOffset + 6, 0x0800, true) // UTF-8 filenames
    view.setUint16(localOffset + 12, 0x0021, true) // January 1, 1980
    view.setUint32(localOffset + 14, file.checksum, true)
    view.setUint32(localOffset + 18, file.data.length, true)
    view.setUint32(localOffset + 22, file.data.length, true)
    view.setUint16(localOffset + 26, file.nameBytes.length, true)
    bytes.set(file.nameBytes, localOffset + 30)
    bytes.set(file.data, localOffset + 30 + file.nameBytes.length)

    view.setUint32(centralOffset, 0x02014b50, true)
    view.setUint16(centralOffset + 4, 20, true)
    view.setUint16(centralOffset + 6, 20, true)
    view.setUint16(centralOffset + 8, 0x0800, true)
    view.setUint16(centralOffset + 14, 0x0021, true)
    view.setUint32(centralOffset + 16, file.checksum, true)
    view.setUint32(centralOffset + 20, file.data.length, true)
    view.setUint32(centralOffset + 24, file.data.length, true)
    view.setUint16(centralOffset + 28, file.nameBytes.length, true)
    view.setUint32(centralOffset + 42, localOffset, true)
    bytes.set(file.nameBytes, centralOffset + 46)

    localOffset += 30 + file.nameBytes.length + file.data.length
    centralOffset += 46 + file.nameBytes.length
  }

  view.setUint32(centralOffset, 0x06054b50, true)
  view.setUint16(centralOffset + 8, files.length, true)
  view.setUint16(centralOffset + 10, files.length, true)
  view.setUint32(centralOffset + 12, directorySize, true)
  view.setUint32(centralOffset + 16, directoryOffset, true)
  return buffer
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
}: DesignExportInput): Promise<DesignExportFile> {
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
