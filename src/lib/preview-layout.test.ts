import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import {
  previewControlBounds,
  speakerPreviewLayout,
  splitPanelPreviewGeometries,
} from './preview-layout'

function box(low: [number, number, number], high: [number, number, number]) {
  const geometry = new BoxGeometry(
    high[0] - low[0],
    high[1] - low[1],
    high[2] - low[2],
  ).toNonIndexed()
  geometry.translate(
    (low[0] + high[0]) / 2,
    (low[1] + high[1]) / 2,
    (low[2] + high[2]) / 2,
  )
  geometry.computeBoundingBox()
  return geometry
}

function fixture(model: 's' | 'm', tallHalo = false) {
  const seam = model === 's' ? 19 : 57
  const front = box(
    [-43, model === 's' ? -65 : -112, 0.1],
    [43, tallHalo ? seam + 35 : seam, tallHalo ? 55 : 4],
  )
  const upper = box([-43, seam - 5, -24], [43, seam + 65, 4])
  const frontPositions = new Float32Array(front.getAttribute('position').array)
  const upperPositions = new Float32Array(upper.getAttribute('position').array)
  const positions = new Float32Array(
    frontPositions.length + upperPositions.length,
  )
  positions.set(frontPositions)
  positions.set(upperPositions, frontPositions.length)
  const panel = new BufferGeometry()
  panel.setAttribute('position', new BufferAttribute(positions, 3))
  panel.computeBoundingBox()
  panel.userData.split = { frontPositions, upperPositions }
  const knob = box([-9, -9, 0], [9, 9, 35])
  knob.userData.knob = { mountHeight: 7 }
  const button = box([-8.95, -8.95, 0], [8.95, 8.95, 9])
  return {
    front,
    upper,
    panel,
    knob,
    button,
    dispose: () =>
      [front, upper, panel, knob, button].forEach((geometry) =>
        geometry.dispose(),
      ),
  }
}

describe('speaker preview part layout', () => {
  it('reuses worker normals for both pieces without modifying source geometry or metadata', () => {
    const parts = fixture('s')
    const frontNormals = new Float32Array(
      parts.front.getAttribute('normal').array,
    )
    const upperNormals = new Float32Array(
      parts.upper.getAttribute('normal').array,
    )
    // Distinct prepared normals prove the meshes reuse the worker's shading
    // instead of silently recalculating it when Exploded is selected.
    frontNormals.fill(0)
    upperNormals.fill(0)
    for (let offset = 0; offset < frontNormals.length; offset += 3)
      frontNormals[offset + 1] = 1
    for (let offset = 0; offset < upperNormals.length; offset += 3)
      upperNormals[offset + 2] = 1
    const normals = new Float32Array(frontNormals.length + upperNormals.length)
    normals.set(frontNormals)
    normals.set(upperNormals, frontNormals.length)
    parts.panel.setAttribute('normal', new BufferAttribute(normals, 3))
    const pieces = splitPanelPreviewGeometries(parts.panel)!
    for (const [index, { part, geometry }] of pieces.entries()) {
      expect(geometry.getAttribute('normal').array).toEqual(
        index === 0 ? frontNormals : upperNormals,
      )
      expect(geometry.getAttribute('normal').array.buffer).not.toBe(
        normals.buffer,
      )
      expect(geometry.getAttribute('position').array).toEqual(
        parts.panel.userData.split[`${part}Positions`],
      )
      expect(geometry.getAttribute('position').array.buffer).not.toBe(
        parts.panel.userData.split[`${part}Positions`].buffer,
      )
      geometry.translate(200, 300, 400)
      geometry.dispose()
    }
    expect(parts.panel.getAttribute('normal').array).toEqual(normals)
    expect(parts.panel.userData.split.frontPositions).toEqual(
      parts.front.getAttribute('position').array,
    )
    parts.dispose()
  })

  it('prepares missing normals for standalone split fixtures', () => {
    const parts = fixture('s')
    const pieces = splitPanelPreviewGeometries(parts.panel)!
    for (const { geometry } of pieces) {
      expect(geometry.getAttribute('normal').count).toBe(
        geometry.getAttribute('position').count,
      )
      expect(
        Array.from(geometry.getAttribute('normal').array).every(
          Number.isFinite,
        ),
      ).toBe(true)
      geometry.dispose()
    }
    parts.dispose()
  })
  it.each(['s', 'm'] as const)(
    'separates every %s split part and frames all of them, including tall halos and knobs',
    (model) => {
      for (const tallHalo of [false, true]) {
        const fixtureParts = fixture(model, tallHalo)
        const { panel, front, upper, knob, button } = fixtureParts
        const before = new Float32Array(panel.getAttribute('position').array)
        const beforeSplit = new Float32Array(
          panel.userData.split.frontPositions,
        )
        const layout = speakerPreviewLayout(
          panel,
          model,
          'exploded',
          knob,
          button,
        )
        const frontBounds = front
          .boundingBox!.clone()
          .translate(new Vector3(...layout.front))
        const upperBounds = upper
          .boundingBox!.clone()
          .translate(new Vector3(...layout.upper))
        const knobBounds = previewControlBounds(knob, 'knob', layout.knob)
        const buttonBounds = previewControlBounds(
          button,
          'powerButton',
          layout.powerButton,
        )
        expect(frontBounds.min.z).toBeGreaterThan(0)
        expect(upperBounds.min.z).toBeGreaterThan(0)
        expect(upperBounds.min.y - frontBounds.max.y).toBeGreaterThanOrEqual(18)
        expect(knobBounds.min.z - upperBounds.max.z).toBeGreaterThanOrEqual(
          18 - 1e-8,
        )
        expect(buttonBounds.min.z - upperBounds.max.z).toBeGreaterThanOrEqual(
          18 - 1e-8,
        )
        expect(knobBounds.min.y - upperBounds.max.y).toBeGreaterThanOrEqual(
          18 - 1e-8,
        )
        expect(buttonBounds.min.y - upperBounds.max.y).toBeGreaterThanOrEqual(
          18 - 1e-8,
        )
        expect(buttonBounds.max.x).toBeLessThan(knobBounds.min.x)
        for (const bounds of [
          frontBounds,
          upperBounds,
          knobBounds,
          buttonBounds,
        ])
          expect(layout.bounds.containsBox(bounds)).toBe(true)
        expect(layout.bounds.min.z).toBeLessThanOrEqual(
          model === 's' ? -57 : -66,
        )
        expect(panel.getAttribute('position').array).toEqual(before)
        expect(panel.userData.split.frontPositions).toEqual(beforeSplit)
        fixtureParts.dispose()
      }
    },
  )

  it('also lifts the two controls away from a one-piece panel', () => {
    const parts = fixture('s', true)
    delete parts.panel.userData.split
    const layout = speakerPreviewLayout(
      parts.panel,
      's',
      'exploded',
      parts.knob,
      parts.button,
    )
    const panelBounds = parts.panel
      .boundingBox!.clone()
      .translate(new Vector3(...layout.front))
    expect(layout.upper).toEqual(layout.front)
    for (const [part, geometry] of [
      ['knob', parts.knob],
      ['powerButton', parts.button],
    ] as const) {
      const bounds = previewControlBounds(geometry, part, layout[part])
      expect(bounds.min.z - panelBounds.max.z).toBeGreaterThanOrEqual(18 - 1e-8)
      expect(bounds.min.y - panelBounds.max.y).toBeGreaterThanOrEqual(18 - 1e-8)
      expect(layout.bounds.containsBox(bounds)).toBe(true)
    }
    parts.dispose()
  })

  it.each(['s', 'm'] as const)(
    'retains the original %s mounting positions and panel-only and knob-only framing',
    (model) => {
      const parts = fixture(model)
      for (const assembly of ['assembled', 'panel'] as const) {
        const layout = speakerPreviewLayout(
          parts.panel,
          model,
          assembly,
          parts.knob,
          parts.button,
        )
        expect(layout.front).toEqual([0, 0, 0])
        expect(layout.upper).toEqual([0, 0, 0])
        expect(layout.knob).toEqual([
          28.5,
          model === 's' ? 29.5 : 70,
          model === 's' ? -6 : -8.5,
        ])
        expect(layout.powerButton).toEqual([
          -28.5,
          model === 's' ? 29.5 : 70,
          model === 's' ? -6 : -8.5,
        ])
        if (assembly === 'panel')
          expect(layout.bounds).toEqual(parts.panel.boundingBox)
        else
          expect(
            layout.bounds.containsBox(
              previewControlBounds(parts.knob, 'knob', layout.knob),
            ),
          ).toBe(true)
      }
      const knobOnly = speakerPreviewLayout(
        parts.panel,
        model,
        'knob',
        parts.knob,
        parts.button,
      )
      expect(knobOnly.bounds).toEqual(
        parts.knob
          .boundingBox!.clone()
          .applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2)),
      )
      parts.dispose()
    },
  )

  it('includes the button seat and indicator in its transformed bounds', () => {
    const button = box([-1, -1, 0], [1, 1, 1])
    const bounds = previewControlBounds(button, 'powerButton', [0, 0, 0])
    const indicator = new Box3(
      new Vector3(-0.45, 0.5, 0.75),
      new Vector3(0.45, 4.5, 0.75),
    ).applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 4))
    expect(bounds.containsBox(indicator)).toBe(true)
    expect(bounds.min.x).toBe(-9.4)
    expect(bounds.max.x).toBe(9.4)
    button.dispose()
  })
})
