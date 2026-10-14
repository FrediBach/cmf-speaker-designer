import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { inspectBinaryStl } from '../../tests/e2e/stl'
import { buildHandledPanelGeometry } from './handles'
import {
  getHandleSlits,
  getHandleStudCenters,
  normalizeHandleSettings,
  type HandleSettings,
} from './handle-settings'
import { exportPanelStl, parsePanelGeometry, type SpeakerModel } from './panels'

function readPanel(model: SpeakerModel) {
  const data = readFileSync(
    new URL(
      `../../resources/stl-files/cmf-speaker-${model}-3d-printing-panel-original-v1.stl`,
      import.meta.url,
    ),
  )
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return parsePanelGeometry(buffer, model)
}

function expectPrintable(mesh: ReturnType<typeof inspectBinaryStl>) {
  expect(mesh.components).toBe(1)
  expect(mesh.invalidEdges).toBe(0)
  expect(mesh.degenerateEdges).toBe(0)
  expect(mesh.signedVolume).toBeGreaterThan(0)
  expect(mesh.minimum[2]).toBeCloseTo(0, 5)
}

describe('angled and curved handle exports', () => {
  it.each(
    (['s', 'm'] as const).flatMap((model) =>
      (['straight', 'outward', 'inward'] as const).map((topShape) => ({
        model,
        topShape,
      })),
    ),
  )(
    'exports a connected $model/$topShape handle with open hair slits and supported studs',
    async ({ model, topShape }) => {
      const original = readPanel(model)
      const settings = normalizeHandleSettings(model, {
        mode: 'custom',
        legoStuds: true,
        height: 45,
        width: 96,
        cornerRadius: 8,
        topAngle: 12,
        topShape,
        topCurve: 10,
        cutout: 'slits',
        holeCount: 5,
        holeWidth: 5,
        holeHeight: 18,
        holeGap: 9,
      })
      const geometry = await buildHandledPanelGeometry(
        original,
        model,
        'original',
        0,
        settings,
      )
      try {
        const mesh = inspectBinaryStl(Buffer.from(exportPanelStl(geometry)))
        expectPrintable(mesh)
        const seamY = geometry.userData.handle.seamY as number
        // Export turns the front toward the print bed, which reverses X.
        const surfaces = (x: number, y: number) => mesh.rayZ(-x, seamY + y)
        const slits = getHandleSlits(model, settings)
        expect(slits).toHaveLength(5)
        for (const slit of slits) {
          expect(surfaces(slit.x, slit.topY - 0.1)).toEqual([])
          expect(surfaces(slit.x, slit.bottomY + 0.1)).toEqual([])
          expect(surfaces(slit.x, slit.bottomY - 0.1)).toHaveLength(2)
          // A point beside the semicircular tip remains material, so these
          // really are rounded open slots rather than rectangular cuts.
          expect(
            surfaces(slit.x + slit.width * 0.45, slit.bottomY + 0.1),
          ).toHaveLength(2)
        }
        const studs = getHandleStudCenters(model, settings)
        expect(studs.length).toBeGreaterThan(0)
        expect(geometry.userData.handle.studCenters).toHaveLength(studs.length)
        for (const stud of studs) {
          const center = surfaces(stud.x, stud.y)
          expect(center).toHaveLength(2)
          expect(center[1] - center[0]).toBeCloseTo(5.8, 3)
          for (const dx of [-2.55, 2.55]) {
            const supportingFace = surfaces(stud.x + dx, stud.y)
            expect(supportingFace).toHaveLength(2)
            expect(supportingFace[1] - supportingFace[0]).toBeCloseTo(4, 3)
          }
        }
      } finally {
        geometry.dispose()
        original.dispose()
      }
    },
    30_000,
  )

  it.each(['s', 'm'] as const)(
    'keeps surviving openings and studs when an angled %s handle cannot fit every opening',
    async (model) => {
      const original = readPanel(model)
      const input: Partial<HandleSettings> = {
        mode: 'custom',
        legoStuds: true,
        height: 40,
        width: 96,
        cornerRadius: 3,
        topAngle: 30,
        topShape: 'straight',
        cutout: 'circle',
        holeCount: 3,
        holeWidth: 14,
        holeGap: 10,
      }
      const settings = normalizeHandleSettings(model, input)
      const geometry = await buildHandledPanelGeometry(
        original,
        model,
        'original',
        0,
        settings,
      )
      try {
        const mesh = inspectBinaryStl(Buffer.from(exportPanelStl(geometry)))
        expectPrintable(mesh)
        const handle = geometry.userData.handle
        const holes = handle.holeCenters as { x: number; y: number }[]
        expect(holes.length).toBeGreaterThan(0)
        expect(holes.length).toBeLessThan(settings.holeCount)
        for (const hole of holes) expect(mesh.rayZ(-hole.x, hole.y)).toEqual([])
        expect(handle.studCenters.length).toBeGreaterThan(0)
        for (const stud of handle.studCenters as { x: number; y: number }[]) {
          const surfaces = mesh.rayZ(-stud.x, stud.y)
          expect(surfaces).toHaveLength(2)
          expect(surfaces[1] - surfaces[0]).toBeCloseTo(5.8, 3)
        }
      } finally {
        geometry.dispose()
        original.dispose()
      }
    },
    30_000,
  )

  it.each([
    {
      model: 's',
      width: 60,
      topAngle: 90,
      topShape: 'outward',
      cutout: 'circle',
    },
    {
      model: 's',
      width: 110,
      topAngle: -90,
      topShape: 'inward',
      cutout: 'slits',
    },
    {
      model: 'm',
      width: 110,
      topAngle: -90,
      topShape: 'outward',
      cutout: 'circle',
    },
    {
      model: 'm',
      width: 60,
      topAngle: 90,
      topShape: 'inward',
      cutout: 'slits',
    },
  ] as const)(
    'exports the minimum $model/$width/$topShape/$cutout profile when every opening is unsafe',
    async ({ model, ...profile }) => {
      const original = readPanel(model)
      const settings = normalizeHandleSettings(model, {
        ...profile,
        mode: 'custom',
        legoStuds: true,
        height: 16,
        cornerRadius: 16,
        topCurve: 30,
        holeCount: 7,
        holeWidth: 64,
        holeHeight: 30,
        holeGap: 3,
      })
      const geometry = await buildHandledPanelGeometry(
        original,
        model,
        'original',
        0,
        settings,
      )
      try {
        expect(geometry.userData.handle.holeCenters).toEqual([])
        expect(getHandleSlits(model, settings)).toEqual([])
        expectPrintable(inspectBinaryStl(Buffer.from(exportPanelStl(geometry))))
      } finally {
        geometry.dispose()
        original.dispose()
      }
    },
    30_000,
  )
})
