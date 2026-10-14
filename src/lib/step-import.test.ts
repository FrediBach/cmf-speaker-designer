import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { BufferGeometry } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseKnobGeometry, prepareKnobExportGeometry } from './knobs'
import { parsePanelGeometry, preparePanelExportGeometry } from './panels'
import { exportStep } from './step-export'
import { createStepMeshPreparer } from './step-mesh'
import { STEP_TOLERANCE_MM } from './step-settings'

interface ImportedMesh {
  attributes: { position: { array: number[] } }
  index: { array: number[] }
  brep_faces: { first: number; last: number }[]
}

interface StepReader {
  ReadStepFile(
    content: Uint8Array,
    options: null,
  ): { success: boolean; meshes: ImportedMesh[] }
}

const initializeOcct = createRequire(import.meta.url)(
  'occt-import-js',
) as () => Promise<StepReader>

function asset(name: string): ArrayBuffer {
  const bytes = readFileSync(
    new URL(`../../resources/stl-files/${name}`, import.meta.url),
  )
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

/** Measure the CAD reader's remeshed result without consulting STEP records. */
function measure(
  meshes: {
    positions: ArrayLike<number>
    indices?: ArrayLike<number>
  }[],
) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const vertices = new Map<string, number>()
  const edges = new Map<string, { count: number; winding: number }>()
  let volume = 0
  let triangles = 0
  for (const { positions, indices } of meshes) {
    const count = indices?.length ?? positions.length / 3
    for (let corner = 0; corner < count; corner += 3) {
      const ids: number[] = []
      const points: number[][] = []
      for (let offset = 0; offset < 3; offset += 1) {
        const index = (indices?.[corner + offset] ?? corner + offset) * 3
        const point = [
          positions[index],
          positions[index + 1],
          positions[index + 2],
        ]
        if (!point.every(Number.isFinite))
          throw new Error('Invalid imported coordinate')
        point.forEach((value, axis) => {
          min[axis] = Math.min(min[axis], value)
          max[axis] = Math.max(max[axis], value)
        })
        // Independently tessellated face boundaries can differ by numeric noise.
        const key = point.map((value) => Math.round(value * 1e6)).join(',')
        let vertex = vertices.get(key)
        if (vertex === undefined) {
          vertex = vertices.size
          vertices.set(key, vertex)
        }
        ids.push(vertex)
        points.push(point)
      }
      const [a, b, c] = points
      volume +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6
      triangles += 1
      for (let side = 0; side < 3; side += 1) {
        const start = ids[side]
        const end = ids[(side + 1) % 3]
        const key = `${Math.min(start, end)},${Math.max(start, end)}`
        const edge = edges.get(key) ?? { count: 0, winding: 0 }
        edge.count += 1
        edge.winding += start < end ? 1 : -1
        edges.set(key, edge)
      }
    }
  }
  const invalidEdges = [...edges.values()].filter(
    ({ count, winding }) => count !== 2 || winding !== 0,
  ).length
  return { min, max, volume, triangles, invalidEdges }
}

function measureGeometry(geometry: BufferGeometry) {
  return measure([
    {
      positions: geometry.getAttribute('position').array,
      indices: geometry.getIndex()?.array,
    },
  ])
}

describe.sequential(
  'STEP import into the independent OpenCascade CAD kernel',
  () => {
    let reader: StepReader
    let preparer: Awaited<ReturnType<typeof createStepMeshPreparer>>
    beforeAll(async () => {
      ;[reader, preparer] = await Promise.all([
        initializeOcct(),
        createStepMeshPreparer(),
      ])
    }, 120_000)

    it.each(['panel-s', 'panel-m', 'bar-knob'] as const)(
      'imports the complete %s with printable dimensions and a closed solid',
      (part) => {
        const source =
          part === 'bar-knob'
            ? parseKnobGeometry(
                asset('cmf-speaker-sm-3d-printing-knob-original-v1.stl'),
                'bar',
              )
            : parsePanelGeometry(
                asset(
                  `cmf-speaker-${part === 'panel-s' ? 's' : 'm'}-3d-printing-panel-original-v1.stl`,
                ),
                part === 'panel-s' ? 's' : 'm',
              )
        const printable =
          part === 'bar-knob'
            ? prepareKnobExportGeometry(source)
            : preparePanelExportGeometry(source)
        const prepared = preparer.prepare(printable)
        try {
          const original = measureGeometry(printable)
          const expected = measureGeometry(prepared)
          const data = exportStep(prepared, `${part}.stp`)
          const started = performance.now()
          const imported = reader.ReadStepFile(new Uint8Array(data), null)
          const elapsed = performance.now() - started
          // Keep failed assertions small: never dump the full CAD mesh or file.
          expect(imported.success).toBe(true)
          expect(imported.meshes.length).toBeGreaterThan(0)
          expect(
            imported.meshes.reduce(
              (sum, mesh) => sum + mesh.brep_faces.length,
              0,
            ),
          ).toBeGreaterThan(0)
          const actual = measure(
            imported.meshes.map((mesh) => ({
              positions: mesh.attributes.position.array,
              indices: mesh.index.array,
            })),
          )
          expect(actual.triangles).toBeGreaterThan(0)
          expect(actual.invalidEdges).toBe(0)
          expect(actual.volume).toBeGreaterThan(0)
          expect(Math.abs(actual.volume / original.volume - 1)).toBeLessThan(
            0.004,
          )
          expect(Math.abs(actual.volume / expected.volume - 1)).toBeLessThan(
            0.00001,
          )
          for (const side of ['min', 'max'] as const) {
            original[side].forEach((value, axis) =>
              expect(Math.abs(value - actual[side][axis])).toBeLessThanOrEqual(
                STEP_TOLERANCE_MM + 0.000001,
              ),
            )
          }
          console.info(
            `${part}: ${(data.byteLength / 1_000_000).toFixed(2)} MB STEP, ${(elapsed / 1000).toFixed(2)} s CAD import, ${actual.triangles} imported triangles`,
          )
        } finally {
          prepared.dispose()
          printable.dispose()
          source.dispose()
        }
      },
      120_000,
    )
  },
)
