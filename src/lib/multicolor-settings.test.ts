import { describe, expect, it } from 'vitest'
import {
  getDefaultMulticolorSettings,
  MULTICOLOR_LIMITS,
  MulticolorValidationError,
  normalizeMulticolorSettings,
} from './multicolor-settings'
import { createPatternElement } from './multicolor-patterns'

describe('multicolor document validation', () => {
  it('keeps legacy designs disabled and allocates independent model defaults', () => {
    const first = normalizeMulticolorSettings(undefined)
    expect(first.enabled).toBe(false)
    expect(first.frame).toEqual({
      centerX: 0,
      centerY: 0,
      width: 85,
      height: 131,
    })
    expect(normalizeMulticolorSettings(null, 'm').frame.height).toBe(225)
    first.frame.width = 100
    expect(getDefaultMulticolorSettings().frame.width).toBe(85)
  })

  it('round-trips deep editable data and canonicalizes angles and colors', () => {
    const initial = getDefaultMulticolorSettings()
    initial.enabled = true
    initial.materials.push({ id: 'red', name: 'Red', color: '#FF0000' })
    const polygon = createPatternElement('polygon', initial.frame, 'red')
    initial.elements.push({ ...polygon, rotation: -450 })
    const restored = normalizeMulticolorSettings(
      JSON.parse(JSON.stringify(initial)),
    )
    expect(restored.elements[0].rotation).toBe(270)
    expect(restored.materials[0].color).toBe('#ff0000')
    expect(normalizeMulticolorSettings(restored)).toEqual(restored)
    if (polygon.kind !== 'polygon' || restored.elements[0].kind !== 'polygon')
      throw new Error('Expected polygon')
    restored.elements[0].points[0][0] = 999
    expect(polygon.points[0][0]).not.toBe(999)
  })

  it('rejects unsupported versions and oversized documents without truncation', () => {
    expect(() => normalizeMulticolorSettings({ version: 2 })).toThrow(
      /unsupported version/,
    )
    const initial = getDefaultMulticolorSettings()
    initial.elements = Array.from(
      { length: MULTICOLOR_LIMITS.elements + 1 },
      () => createPatternElement('circle', initial.frame),
    )
    expect(() => normalizeMulticolorSettings(initial)).toThrow(/at most 128/)
    expect(initial.elements).toHaveLength(129)
  })

  it.each([NaN, Infinity, -Infinity, '10', null])(
    'rejects invalid finite coordinates: %s',
    (x) => {
      const initial = getDefaultMulticolorSettings()
      expect(() =>
        normalizeMulticolorSettings({
          ...initial,
          elements: [{ ...createPatternElement('circle', initial.frame), x }],
        }),
      ).toThrow(MulticolorValidationError)
    },
  )

  it('rejects invalid palette references, duplicate IDs and the reserved base ID', () => {
    const initial = getDefaultMulticolorSettings()
    const element = createPatternElement('circle', initial.frame)
    expect(() =>
      normalizeMulticolorSettings({
        ...initial,
        elements: [{ ...element, materialId: 'missing' }],
      }),
    ).toThrow(/missing material/)
    expect(() =>
      normalizeMulticolorSettings({ ...initial, elements: [element, element] }),
    ).toThrow(/duplicate ID/)
    expect(() =>
      normalizeMulticolorSettings({
        ...initial,
        materials: [{ id: 'base', name: 'Background', color: '#ffffff' }],
      }),
    ).toThrow(/duplicate ID/)
    expect(() =>
      normalizeMulticolorSettings({
        ...initial,
        elements: [{ ...element, groupId: 'missing' }],
      }),
    ).toThrow(/missing group/)
  })

  it('rejects self-intersecting, degenerate and oversized polygons', () => {
    const initial = getDefaultMulticolorSettings()
    const element = createPatternElement('polygon', initial.frame)
    for (const points of [
      [
        [0, 0],
        [2, 2],
        [0, 2],
        [2, 0],
      ],
      [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      [
        [0, 0],
        [1, 0],
        [1, 0],
        [0, 1],
      ],
    ]) {
      expect(() =>
        normalizeMulticolorSettings({
          ...initial,
          elements: [{ ...element, points }],
        }),
      ).toThrow(/simple shape/)
    }
    expect(() =>
      normalizeMulticolorSettings({
        ...initial,
        elements: [
          {
            ...element,
            points: Array.from({ length: 129 }, (_, index) => [
              Math.cos(index),
              Math.sin(index),
            ]),
          },
        ],
      }),
    ).toThrow(/at most 128/)
  })

  it('rejects invalid ring and cross dimensions while keeping the authored input intact', () => {
    const initial = getDefaultMulticolorSettings()
    const circle = {
      ...createPatternElement('circle', initial.frame),
      radius: 5,
      innerRadius: 5,
    }
    expect(() =>
      normalizeMulticolorSettings({ ...initial, elements: [circle] }),
    ).toThrow(/Inner radius/)
    expect(circle.radius).toBe(5)
    const cross = {
      ...createPatternElement('cross', initial.frame),
      horizontalThickness: 1000,
    }
    expect(() =>
      normalizeMulticolorSettings({ ...initial, elements: [cross] }),
    ).toThrow(/Cross arms/)
  })
})
