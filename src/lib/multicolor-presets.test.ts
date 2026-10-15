import { describe, expect, it } from 'vitest'
import {
  getDefaultMulticolorSettings,
  normalizeMulticolorSettings,
  type PatternPoint,
  type MulticolorSettings,
} from './multicolor-settings'
import { getElementContours } from './multicolor-patterns'
import { applyMulticolorPreset, MULTICOLOR_PRESETS } from './multicolor-presets'

function inside(points: PatternPoint[], x: number, y: number) {
  let result = false
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index++
  ) {
    const a = points[index],
      b = points[previous]
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result
  }
  return result
}
function colorAt(
  settings: MulticolorSettings,
  panelColor: string,
  x: number,
  y: number,
) {
  for (const element of [...settings.elements].reverse()) {
    const contours = getElementContours(element)
    if (
      element.visible &&
      inside(contours[0], x, y) &&
      !contours.slice(1).some((contour) => inside(contour, x, y))
    )
      return element.materialId === 'base'
        ? panelColor
        : settings.materials.find(
            (material) => material.id === element.materialId,
          )!.color
  }
  return panelColor
}

describe('editable flag recipes', () => {
  it.each(MULTICOLOR_PRESETS)(
    '$name produces ordinary valid elements and a proportional frame',
    ({ id, aspectRatio }) => {
      const original = getDefaultMulticolorSettings()
      const { settings } = applyMulticolorPreset(id, original, 'proportional')
      expect(settings.enabled).toBe(true)
      expect(settings.elements.length).toBeGreaterThan(0)
      expect(settings.frame.width / settings.frame.height).toBeCloseTo(
        aspectRatio,
      )
      expect(normalizeMulticolorSettings(settings)).toEqual(settings)
      expect(original).toEqual(getDefaultMulticolorSettings())
      expect(
        settings.elements.every((element) =>
          ['stripe', 'cross', 'circle', 'polygon'].includes(element.kind),
        ),
      ).toBe(true)
    },
  )

  it('orders tricolors from left to right and horizontal flags from top to bottom', () => {
    const france = applyMulticolorPreset(
      'france',
      getDefaultMulticolorSettings(),
    )
    expect(
      [-30, 0, 30].map((x) =>
        colorAt(france.settings, france.panelColor, x, 0),
      ),
    ).toEqual(['#0055a4', '#ffffff', '#ef4135'])
    const germany = applyMulticolorPreset(
      'germany',
      getDefaultMulticolorSettings(),
    )
    expect(
      [50, 0, -50].map((y) =>
        colorAt(germany.settings, germany.panelColor, 0, y),
      ),
    ).toEqual(['#000000', '#dd0000', '#ffce00'])
  })

  it('keeps the Swiss cross bounded and the Nordic intersection toward the hoist', () => {
    const swiss = applyMulticolorPreset(
      'switzerland',
      getDefaultMulticolorSettings(),
      'proportional',
    )
    expect(colorAt(swiss.settings, swiss.panelColor, 0, 0)).toBe('#ffffff')
    expect(colorAt(swiss.settings, swiss.panelColor, 40, 0)).toBe('#ff0000')
    const norway = applyMulticolorPreset(
      'norway',
      getDefaultMulticolorSettings(),
      'proportional',
    )
    expect(norway.settings.elements[0].x).toBeLessThan(
      norway.settings.frame.centerX,
    )
    expect(
      colorAt(
        norway.settings,
        norway.panelColor,
        norway.settings.elements[0].x,
        20,
      ),
    ).toBe('#00205b')
  })

  it('uses asymmetric counterchanged UK diagonals with the broad white margin uppermost at the hoist', () => {
    const initial = getDefaultMulticolorSettings()
    initial.frame = { centerX: 0, centerY: 0, width: 50, height: 30 }
    const { settings, panelColor } = applyMulticolorPreset(
      'united-kingdom',
      initial,
    )
    const normal = [30 / Math.hypot(50, 30), 50 / Math.hypot(50, 30)]
    // On the upper-left to lower-right diagonal, one unit below the
    // center line is red at the hoist and white at the fly.
    expect(
      colorAt(settings, panelColor, -18 - normal[0], 10.8 - normal[1]),
    ).toBe('#c8102e')
    expect(
      colorAt(settings, panelColor, -18 + normal[0], 10.8 + normal[1]),
    ).toBe('#ffffff')
    expect(
      colorAt(settings, panelColor, 18 + normal[0], -10.8 + normal[1]),
    ).toBe('#c8102e')
    expect(
      colorAt(settings, panelColor, 18 - normal[0], -10.8 - normal[1]),
    ).toBe('#ffffff')
    expect(colorAt(settings, panelColor, 0, 0)).toBe('#c8102e')
    expect(
      settings.elements.filter((element) => element.kind === 'polygon'),
    ).toHaveLength(6)
  })

  it('keeps Japan circular on a tall panel and allows every rainbow band to be edited', () => {
    const japan = applyMulticolorPreset(
      'japan',
      getDefaultMulticolorSettings('m'),
    )
    const disc = japan.settings.elements[0]
    expect(disc.kind).toBe('circle')
    expect(colorAt(japan.settings, japan.panelColor, 20, 0)).toBe('#bc002d')
    expect(colorAt(japan.settings, japan.panelColor, 0, 20)).toBe('#bc002d')
    expect(colorAt(japan.settings, japan.panelColor, 30, 0)).toBe('#ffffff')
    const rainbow = applyMulticolorPreset(
      'rainbow',
      getDefaultMulticolorSettings(),
    )
    expect(rainbow.settings.elements).toHaveLength(6)
    expect(colorAt(rainbow.settings, rainbow.panelColor, 0, 60)).toBe('#e40303')
    expect(colorAt(rainbow.settings, rainbow.panelColor, 0, -60)).toBe(
      '#732982',
    )
  })
})
