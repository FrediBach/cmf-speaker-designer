import { Box3, Matrix4, Mesh, Vector3, type BufferGeometry } from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { buildArchive } from './archive'

export interface ThreeMfPart {
  id: string
  name: string
  color: string
  geometry: BufferGeometry
}

export interface ThreeMfAssembly {
  name: string
  parts: ThreeMfPart[]
}

const encoder = new TextEncoder()
const xml = (value: string) => {
  if (
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u.test(
      value,
    )
  )
    throw new Error(
      'A material name contains characters that cannot be written to 3MF. Rename the material and retry.',
    )
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  )
}

/** Derive this once from the complete panel; never ground individual regions. */
export function panelAssemblyTransform(geometry: BufferGeometry) {
  const rotation = new Matrix4().makeRotationY(Math.PI)
  const position = geometry.getAttribute('position')
  const point = new Vector3()
  const bounds = new Box3()
  for (let index = 0; index < position.count; index++)
    bounds.expandByPoint(
      point.fromBufferAttribute(position, index).applyMatrix4(rotation),
    )
  if (bounds.isEmpty()) throw new Error('The panel has no printable geometry.')
  return new Matrix4().makeTranslation(0, 0, -bounds.min.z).multiply(rotation)
}

/** Serialize already placed geometry without any extra centering or grounding. */
export function serializePlacedStl(geometry: BufferGeometry): ArrayBuffer {
  const mesh = new Mesh(geometry)
  mesh.updateMatrixWorld(true)
  const binary = new STLExporter().parse(mesh, { binary: true })
  const bytes = new Uint8Array(binary.byteLength)
  bytes.set(new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength))
  return bytes.buffer
}

function meshXml(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position')
  const sourceIndex = geometry.getIndex()
  const vertices: string[] = []
  const indices: number[] = []
  if (sourceIndex) {
    // Manifold's index preserves distinct shells even where coordinates coincide.
    for (let index = 0; index < positions.count; index++) {
      const coordinates = [
        positions.getX(index),
        positions.getY(index),
        positions.getZ(index),
      ]
      if (!coordinates.every(Number.isFinite))
        throw new Error('Invalid 3MF vertex.')
      vertices.push(
        `<vertex x="${coordinates[0]}" y="${coordinates[1]}" z="${coordinates[2]}"/>`,
      )
    }
    for (let index = 0; index < sourceIndex.count; index++)
      indices.push(sourceIndex.getX(index))
  } else {
    // Legacy canonical panels are triangle soup with manifold coordinate edges.
    // Only this legacy path welds exact coordinates; partition meshes retain indices.
    const ids = new Map<string, number>()
    for (let index = 0; index < positions.count; index++) {
      const coordinates = [
        positions.getX(index),
        positions.getY(index),
        positions.getZ(index),
      ]
      if (!coordinates.every(Number.isFinite))
        throw new Error('Invalid 3MF vertex.')
      const key = coordinates.join(',')
      let id = ids.get(key)
      if (id === undefined) {
        id = vertices.length
        ids.set(key, id)
        vertices.push(
          `<vertex x="${coordinates[0]}" y="${coordinates[1]}" z="${coordinates[2]}"/>`,
        )
      }
      indices.push(id)
    }
  }
  if (!indices.length || indices.length % 3)
    throw new Error('The 3MF mesh contains no complete triangles.')
  const triangles: string[] = []
  for (let index = 0; index < indices.length; index += 3) {
    const triangle = indices.slice(index, index + 3)
    if (
      triangle.some(
        (id) => !Number.isInteger(id) || id < 0 || id >= vertices.length,
      ) ||
      new Set(triangle).size !== 3
    )
      throw new Error('The 3MF mesh contains an invalid triangle.')
    triangles.push(
      `<triangle v1="${triangle[0]}" v2="${triangle[1]}" v3="${triangle[2]}"/>`,
    )
  }
  return `<mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh>`
}

/** Generic Core 3MF: assignable material volumes, no printer/process presets. */
export function exportThreeMf(
  assemblies: ThreeMfAssembly[],
  metadata: unknown,
): ArrayBuffer {
  if (
    !assemblies.length ||
    assemblies.some((assembly) => !assembly.parts.length)
  )
    throw new Error('A 3MF assembly needs at least one material part.')
  const parts = assemblies.flatMap((assembly) => assembly.parts)
  const resources: string[] = []
  resources.push(
    `<basematerials id="1">${parts
      .map((part) => {
        if (!/^#[0-9a-f]{6}$/i.test(part.color))
          throw new Error('Invalid 3MF material color.')
        return `<base name="${xml(part.name)}" displaycolor="${part.color.toUpperCase()}FF"/>`
      })
      .join('')}</basematerials>`,
  )
  let nextId = 2
  let materialIndex = 0
  const build: string[] = []
  const materialObjects: {
    materialId: string
    objectId: number
    assembly: string
    name: string
    color: string
  }[] = []
  for (const assembly of assemblies) {
    const components: string[] = []
    for (const part of assembly.parts) {
      const id = nextId++
      resources.push(
        `<object id="${id}" name="${xml(part.name)}" type="model" pid="1" pindex="${materialIndex++}">${meshXml(part.geometry)}</object>`,
      )
      components.push(`<component objectid="${id}"/>`)
      materialObjects.push({
        materialId: part.id,
        objectId: id,
        assembly: assembly.name,
        name: part.name,
        color: part.color,
      })
    }
    const assemblyId = nextId++
    resources.push(
      `<object id="${assemblyId}" name="${xml(assembly.name)}" type="model"><components>${components.join('')}</components></object>`,
    )
    build.push(`<item objectid="${assemblyId}"/>`)
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">CMF Speaker Designer</metadata><metadata name="Title">CMF Speaker multicolor design</metadata><resources>${resources.join('')}</resources><build>${build.join('')}</build></model>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="json" ContentType="application/json"/></Types>`
  const relationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`
  return buildArchive([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(relationships) },
    { name: '3D/3dmodel.model', data: encoder.encode(model) },
    {
      name: 'Metadata/design.json',
      data: encoder.encode(`${JSON.stringify(metadata, null, 2)}\n`),
    },
    {
      name: 'Metadata/materials.json',
      data: encoder.encode(
        `${JSON.stringify({ units: 'mm', objects: materialObjects }, null, 2)}\n`,
      ),
    },
  ])
}
