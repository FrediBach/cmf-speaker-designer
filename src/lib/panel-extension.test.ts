import { readFileSync } from 'node:fs'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import { normalizeGrilleSettings } from './grille-settings'
import { normalizeHaloSettings } from './halo-settings'
import { getDefaultHandleSettings } from './handle-settings'
import { buildHandledPanelGeometry } from './handles'
import { applyPanelExtension, MAX_PANEL_EXTENSION } from './panel-extension'
import { parsePanelGeometry, type SpeakerModel } from './panels'

function readPanel(model: SpeakerModel) {
  const bytes = readFileSync(
    new URL(
      `../../resources/stl-files/cmf-speaker-${model}-3d-printing-panel-original-v1.stl`,
      import.meta.url,
    ),
  )
  const data = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(data).set(bytes)
  return parsePanelGeometry(data, model)
}

function topology(positions: Float32Array) {
  const unique = new Map<string, number>()
  const ids: number[] = []
  const parents: number[] = []
  const find = (id: number): number => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]]
      id = parents[id]
    }
    return id
  }
  for (let index = 0; index < positions.length; index += 3) {
    const point = Array.from(positions.subarray(index, index + 3))
    if (!point.every(Number.isFinite)) throw new Error('Non-finite vertex')
    const key = point.join(',')
    let id = unique.get(key)
    if (id === undefined) {
      id = unique.size
      unique.set(key, id)
      parents.push(id)
    }
    ids.push(id)
  }
  const edges = new Map<number, number>()
  for (let triangle = 0; triangle < ids.length; triangle += 3)
    for (let edge = 0; edge < 3; edge += 1) {
      const a = ids[triangle + edge]
      const b = ids[triangle + ((edge + 1) % 3)]
      if (a === b) throw new Error('Collapsed triangle edge')
      const key = Math.min(a, b) * unique.size + Math.max(a, b)
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
      parents[find(a)] = find(b)
    }
  return {
    invalidEdges: [...edges.values()].filter((count) => count !== 20).length,
    components: new Set(parents.map((_, id) => find(id))).size,
  }
}

function heights(geometry: BufferGeometry, x: number, y: number) {
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  const ray = new Raycaster(new Vector3(x, y, 150), new Vector3(0, 0, -1))
  const hits = ray.intersectObject(mesh).map((hit) => hit.point.z)
  material.dispose()
  return [...new Set(hits.map((z) => Number(z.toFixed(4))))].sort(
    (a, b) => a - b,
  )
}

describe('panel side extension', () => {
  it('keeps zero extension untouched and rejects invalid dimensions', () => {
    const positions = new Float32Array(9)
    expect(applyPanelExtension(positions, 's', 0)).toBe(positions)
    for (const extension of [-0.1, 10.1, NaN, Infinity])
      expect(() => applyPanelExtension(positions, 's', extension)).toThrow(
        RangeError,
      )
    expect(MAX_PANEL_EXTENSION).toBe(10)
  })

  it.each(['s', 'm'] as const)(
    'extends the %s side borders while retaining exact openings, controls and mounts',
    (model) => {
      const source = readPanel(model)
      const positions = new Float32Array(source.getAttribute('position').array)
      const original = positions.slice()
      const deckIntercept = model === 's' ? 23.5 : 61.5
      const deckBack = Math.fround(deckIntercept - 3.5 * Math.SQRT2)
      const handleSeam = source.boundingBox!.max.y - (model === 's' ? 24 : 27)
      try {
        for (const extension of [0.1, MAX_PANEL_EXTENSION]) {
          const extended = applyPanelExtension(positions, model, extension)
          expect(topology(extended)).toEqual({ invalidEdges: 0, components: 1 })
          const vertices = new Set<string>()
          for (let index = 0; index < extended.length; index += 3)
            vertices.add(
              `${extended[index]},${extended[index + 1]},${extended[index + 2]}`,
            )
          let missing = 0
          for (let index = 0; index < positions.length; index += 3)
            if (
              Math.abs(positions[index]) <= Math.fround(39.1) ||
              (positions[index + 2] <= 0.5 &&
                positions[index + 1] + positions[index + 2] <=
                  deckBack + 0.00002) ||
              positions[index + 1] >= handleSeam + 4
            )
              if (
                !vertices.has(
                  `${positions[index]},${positions[index + 1]},${positions[index + 2]}`,
                )
              )
                missing += 1
          expect(missing).toBe(0)
          const geometry = new BufferGeometry()
          geometry.setAttribute(
            'position',
            new Float32BufferAttribute(extended, 3),
          )
          geometry.computeBoundingBox()
          const box = geometry.boundingBox!
          // The fixed rear fillet is 0.016 mm wider than the extended front.
          expect(box.min.x).toBeCloseTo(
            source.boundingBox!.min.x - extension,
            1,
          )
          expect(box.max.x).toBeCloseTo(
            source.boundingBox!.max.x + extension,
            1,
          )
          expect(box.min.y).toBe(source.boundingBox!.min.y)
          expect(box.max.y).toBe(source.boundingBox!.max.y)
          expect(box.min.z).toBe(source.boundingBox!.min.z)
          expect(box.max.z).toBe(source.boundingBox!.max.z)
          if (extension === MAX_PANEL_EXTENSION) {
            const driverY = model === 's' ? -23 : 15
            expect(heights(geometry, 0, driverY)).toEqual([])
            // Both new wings have material beyond the original speaker box.
            for (const x of [-48, 48]) {
              const faces = heights(geometry, x, driverY)
              expect(faces.at(-1)).toBeCloseTo(4, 4)
              expect(faces.at(-1)! - faces[0]).toBeGreaterThan(3)
            }
            const deckY = model === 's' ? 29.5 : 70
            for (const x of [-50, 50]) {
              expect(heights(source, x, deckY)).toEqual([])
              const faces = heights(geometry, x, deckY)
              expect(faces.at(-1)).toBeCloseTo(deckIntercept - deckY, 4)
              expect((faces.at(-1)! - faces[0]) / Math.SQRT2).toBeGreaterThan(3)
            }
          }
          geometry.dispose()
        }
        expect(positions).toEqual(original)
      } finally {
        source.dispose()
      }
    },
    30_000,
  )

  it.each(['s', 'm'] as const)(
    'joins the widened %s deck directly to independently sized handles',
    async (model) => {
      const source = readPanel(model)
      try {
        for (const width of [60, 110]) {
          const geometry = await buildHandledPanelGeometry(
            source,
            model,
            'original',
            0,
            {
              ...getDefaultHandleSettings(model),
              mode: 'custom',
              width,
              height: 35,
              legoStuds: true,
            },
            undefined,
            undefined,
            MAX_PANEL_EXTENSION,
          )
          try {
            const { seamY, backZ, holeCenters, studCenters } =
              geometry.userData.handle
            const positions = geometry.getAttribute('position')
            let minX = Infinity,
              maxX = -Infinity
            for (let index = 0; index < positions.count; index += 1)
              if (positions.getY(index) >= seamY + 4) {
                minX = Math.min(minX, positions.getX(index))
                maxX = Math.max(maxX, positions.getX(index))
              }
            expect(maxX - minX).toBeCloseTo(width, 4)
            expect(topology(new Float32Array(positions.array))).toEqual({
              invalidEdges: 0,
              components: 1,
            })
            for (const hole of holeCenters)
              expect(heights(geometry, hole.x, hole.y)).toEqual([])
            for (const stud of studCenters)
              expect(heights(geometry, stud.x, stud.y).at(-1)).toBeCloseTo(
                backZ + 4 + 1.8,
                4,
              )
            // Halfway through the existing 4 mm shoulder, each edge lies
            // halfway between the extended collar and selected handle width.
            const shoulderHalfWidth = (84.9715 + 20 + width) / 4
            for (const sign of [-1, 1]) {
              expect(
                heights(
                  geometry,
                  sign * (shoulderHalfWidth - 0.2),
                  seamY + 2,
                ).at(-1),
              ).toBeCloseTo(backZ + 4, 4)
              expect(
                heights(geometry, sign * (shoulderHalfWidth + 0.2), seamY + 2),
              ).toEqual([])
            }
          } finally {
            geometry.dispose()
          }
        }
      } finally {
        source.dispose()
      }
    },
    60_000,
  )

  it('refreshes the custom handle base when side extension changes and resets', async () => {
    const source = readPanel('s')
    try {
      for (const extension of [0, MAX_PANEL_EXTENSION, 0]) {
        const geometry = await buildHandledPanelGeometry(
          source,
          's',
          'original',
          0,
          {
            ...getDefaultHandleSettings('s'),
            mode: 'custom',
            width: 70,
            height: 35,
          },
          undefined,
          undefined,
          extension,
        )
        try {
          const slope = heights(geometry, 50, 29.5)
          if (extension === 0) expect(slope).toEqual([])
          else expect(slope.at(-1)).toBeCloseTo(-6, 4)
        } finally {
          geometry.dispose()
        }
      }
    } finally {
      source.dispose()
    }
  }, 60_000)

  it.each(['s', 'm'] as const)(
    'keeps an extended %s panel closed with a custom handle, face depth, grille and halo',
    async (model) => {
      const source = readPanel(model)
      const geometry = await buildHandledPanelGeometry(
        source,
        model,
        'original',
        2,
        { ...getDefaultHandleSettings(model), mode: 'custom', legoStuds: true },
        normalizeGrilleSettings({ mode: 'custom', extendPattern: true }),
        normalizeHaloSettings({ mode: 'custom', depth: 12, cutAngle: 30 }),
        MAX_PANEL_EXTENSION,
      )
      try {
        expect(
          topology(new Float32Array(geometry.getAttribute('position').array)),
        ).toEqual({ invalidEdges: 0, components: 1 })
        expect(geometry.userData.panelExtension).toBe(MAX_PANEL_EXTENSION)
        for (const hole of geometry.userData.handle.holeCenters)
          expect(heights(geometry, hole.x, hole.y)).toEqual([])
        for (const x of [-48, 48])
          expect(
            heights(geometry, x, model === 's' ? -23 : 15).at(-1),
          ).toBeCloseTo(6, 4)
        // The untouched rear envelope still meets the same mounting plane.
        expect(geometry.boundingBox!.min.z).toBe(source.boundingBox!.min.z)
      } finally {
        geometry.dispose()
        source.dispose()
      }
    },
    60_000,
  )
})
