import { readFileSync } from 'node:fs'
import { Box3, BoxGeometry, BufferGeometry, Vector3 } from 'three'
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { validateDesign } from './design'
import { buildDesignExport } from './design-export'
import { buildHandledPanelGeometry } from './handles'
import * as multicolorClient from './multicolor-client'
import type { MaterialGeometry } from './multicolor-geometry'
import { parsePanelGeometry } from './panels'

const design = validateDesign(
  JSON.parse(
    readFileSync(
      new URL('./__fixtures__/split-text-design.json', import.meta.url),
      'utf8',
    ),
  ),
)

interface TriangleMesh {
  points: number[][]
  triangles: number[][]
}

function geometryMesh(geometry: BufferGeometry): TriangleMesh {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const points: number[][] = []
  const triangles: number[][] = []
  const ids = new Map<string, number>()
  const references = new Uint32Array(position.count)
  for (let vertex = 0; vertex < position.count; vertex++) {
    const point = [
      position.getX(vertex),
      position.getY(vertex),
      position.getZ(vertex),
    ]
    // STL has no indices. Reconstruct its shared-coordinate topology.
    const key = point.join(',')
    let id = index ? vertex : ids.get(key)
    if (id === undefined) {
      id = points.length
      ids.set(key, id)
    }
    if (id === points.length) points.push(point)
    references[vertex] = id
  }
  for (let offset = 0; offset < (index?.count ?? position.count); offset += 3)
    triangles.push(
      [0, 1, 2].map(
        (corner) =>
          references[index ? index.getX(offset + corner) : offset + corner],
      ),
    )
  return { points, triangles }
}

function xmlMesh(source: string): TriangleMesh {
  return {
    points: [
      ...source.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g),
    ].map((match) => match.slice(1).map(Number)),
    triangles: [
      ...source.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g),
    ].map((match) => match.slice(1).map(Number)),
  }
}

function assertClosedVolume(mesh: TriangleMesh) {
  const { points, triangles } = mesh
  const edges = new Map<string, { count: number; direction: number }>()
  expect(triangles.length).toBeGreaterThan(0)
  expect(points.every((point) => point.every(Number.isFinite))).toBe(true)
  const origin = new Vector3(...(points[0] as [number, number, number]))
  let volume = 0
  let degenerate = 0
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map(
      (id) => new Vector3(...(points[id] as [number, number, number])),
    )
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() === 0) degenerate++
    volume += a.sub(origin).dot(b.sub(origin).cross(c.sub(origin))) / 6
    for (let index = 0; index < 3; index++) {
      const from = triangle[index],
        to = triangle[(index + 1) % 3]
      const key = `${Math.min(from, to)}:${Math.max(from, to)}`
      const edge = edges.get(key) ?? { count: 0, direction: 0 }
      edge.count++
      edge.direction += from < to ? 1 : -1
      edges.set(key, edge)
    }
  }
  expect(degenerate).toBe(0)
  expect(
    [...edges.values()].filter(
      ({ count, direction }) => count !== 2 || direction !== 0,
    ),
  ).toHaveLength(0)
  expect(volume).toBeGreaterThan(0)
  return volume
}

describe('exact split Speaker M rotated text export regression', () => {
  let panel: BufferGeometry
  let regions: MaterialGeometry[] = []
  const knob = new BoxGeometry(10, 10, 10)
  const powerButton = new BoxGeometry(6, 6, 3)

  beforeAll(async () => {
    const bytes = readFileSync(
      new URL(
        '../../resources/stl-files/cmf-speaker-m-3d-printing-panel-original-v1.stl',
        import.meta.url,
      ),
    )
    const source = parsePanelGeometry(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      'm',
    )
    try {
      panel = await buildHandledPanelGeometry(
        source,
        'm',
        'original',
        design.relief,
        design.handle,
        design.grille,
        design.halo,
        design.panelExtension,
        design.panelGap,
        design.raceStripes,
        undefined,
        design.panelSplit,
      )
    } finally {
      source.dispose()
    }
    regions = (
      await multicolorClient.buildMulticolorGeometry(panel, design.multicolor)
    ).parts
  }, 60_000)

  afterAll(() => {
    panel?.dispose()
    knob.dispose()
    powerButton.dispose()
    regions.forEach(({ geometry, previewGeometry }) => {
      geometry.dispose()
      previewGeometry?.dispose()
    })
  })

  it('rejects incomplete current material groups instead of omitting a panel piece', async () => {
    await expect(
      buildDesignExport({
        panel,
        knob,
        powerButton,
        design,
        target: 'panel',
        format: '3mf',
        materialParts: regions.filter(({ panelPart }) => panelPart === 'front'),
      }),
    ).rejects.toThrow('The split material regions are incomplete')
  })

  it.each(['3mf', 'stl-parts'] as const)(
    'preserves both physical solids, text colors and closed nondegenerate meshes in %s',
    async (format) => {
      const spy = vi.spyOn(multicolorClient, 'buildMulticolorGeometry')
      try {
        const file = await buildDesignExport({
          panel,
          knob,
          powerButton,
          design,
          target: 'panel',
          format,
          materialParts: regions,
        })
        expect(spy).not.toHaveBeenCalled()
        const entries = unzipSync(new Uint8Array(file.data))
        const exported: {
          mesh: TriangleMesh
          materialId: string
          panelPart: string
        }[] = []
        if (format === '3mf') {
          const source = strFromU8(entries['3D/3dmodel.model'])
          expect(source.match(/<item /g)).toHaveLength(2)
          const meshes = new Map(
            [
              ...source.matchAll(
                /<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g,
              ),
            ].map((match) => [Number(match[1]), match[2]]),
          )
          const metadata = JSON.parse(
            strFromU8(entries['Metadata/materials.json']),
          ) as {
            objects: {
              objectId: number
              materialId: string
              assembly: string
            }[]
          }
          for (const part of metadata.objects)
            exported.push({
              mesh: xmlMesh(meshes.get(part.objectId)!),
              materialId: part.materialId,
              panelPart: part.assembly.endsWith('front panel')
                ? 'front'
                : 'upper',
            })
        } else {
          const manifest = JSON.parse(strFromU8(entries['materials.json'])) as {
            parts: { file: string; materialId: string; assembly: string }[]
          }
          for (const part of manifest.parts) {
            const geometry = new STLLoader().parse(
              entries[part.file].slice().buffer as ArrayBuffer,
            )
            try {
              exported.push({
                mesh: geometryMesh(geometry),
                materialId: part.materialId,
                panelPart: part.assembly.endsWith('front panel')
                  ? 'front'
                  : 'upper',
              })
            } finally {
              geometry.dispose()
            }
          }
        }
        expect(exported).toHaveLength(regions.length)
        const bounds = { front: new Box3(), upper: new Box3() }
        for (const { mesh, materialId, panelPart } of exported) {
          const original = regions.find(
            (region) =>
              region.materialId === materialId &&
              region.panelPart === panelPart,
          )
          expect(original).toBeDefined()
          const actualVolume = assertClosedVolume(mesh)
          expect(Math.abs(actualVolume - original!.volume)).toBeLessThan(
            Math.max(0.002, original!.volume * 0.000001),
          )
          expect(mesh.triangles).toHaveLength(
            original!.geometry.getIndex()!.count / 3,
          )
          for (const point of mesh.points)
            bounds[panelPart as 'front' | 'upper'].expandByPoint(
              new Vector3(...(point as [number, number, number])),
            )
        }
        expect(bounds.front.min.z).toBeCloseTo(0, 4)
        expect(bounds.upper.min.z).toBeCloseTo(0, 4)
        expect(bounds.upper.min.x - bounds.front.max.x).toBeCloseTo(10, 4)
      } finally {
        spy.mockRestore()
      }
    },
    60_000,
  )
})
