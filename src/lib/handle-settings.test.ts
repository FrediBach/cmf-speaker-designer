import { describe, expect, it } from 'vitest'
import {
  getDefaultHandleSettings,
  getHandleLimits,
  normalizeHandleSettings,
  type HandleSettings,
} from './handle-settings'

function outerDistance(x: number, y: number, handle: HandleSettings) {
  const qx = Math.abs(x) - handle.width / 2 + handle.cornerRadius
  const qy =
    Math.abs(y - handle.height / 2) - handle.height / 2 + handle.cornerRadius
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    handle.cornerRadius
  )
}

describe('printable custom handle settings', () => {
  it('keeps original handles by default and does not mutate input settings', () => {
    expect(getDefaultHandleSettings('s').height).toBe(24)
    expect(getDefaultHandleSettings('m').height).toBe(27)
    expect(normalizeHandleSettings('s').mode).toBe('original')
    const requested = Object.freeze({
      mode: 'custom' as const,
      height: 100,
      offsetX: 100,
    })
    const normalized = normalizeHandleSettings('s', requested)
    expect(normalized.height).toBe(70)
    expect(requested).toEqual({ mode: 'custom', height: 100, offsetX: 100 })
    expect(normalizeHandleSettings('s', normalized)).toEqual(normalized)
  })

  it('rejects non-finite and invalid values arriving from saved or shared JSON', () => {
    const invalid = {
      mode: 'unknown',
      cutout: 'triangle',
      height: Number.NaN,
      width: Infinity,
      cornerRadius: -Infinity,
      holeCount: Number.NaN,
      holeWidth: '64',
      holeHeight: null,
      holeGap: {},
      offsetX: Infinity,
      offsetY: Number.NaN,
    } as unknown as Partial<HandleSettings>
    expect(normalizeHandleSettings('s', invalid)).toEqual(
      normalizeHandleSettings('s'),
    )
    expect(normalizeHandleSettings('m', invalid)).toEqual(
      normalizeHandleSettings('m'),
    )
  })

  it('retains circular holes and at least three millimeters of material under extreme edits', () => {
    const violations: string[] = []
    let cases = 0
    for (const model of ['s', 'm'] as const) {
      for (const height of [16, 24, 70]) {
        for (const width of [60, 85, 110]) {
          for (const cornerRadius of [0, 3, 16]) {
            for (const cutout of ['circle', 'slot'] as const) {
              for (const holeCount of [1, 2, 3]) {
                for (const [offsetX, offsetY] of [
                  [-30, -24],
                  [0, 0],
                  [30, 24],
                ]) {
                  const handle = normalizeHandleSettings(model, {
                    mode: 'custom',
                    height,
                    width,
                    cornerRadius,
                    cutout,
                    holeCount,
                    holeWidth: 64,
                    holeHeight: 30,
                    holeGap: 20,
                    offsetX,
                    offsetY,
                  })
                  const detail = JSON.stringify(handle)
                  cases += 1
                  if (
                    handle.cutout === 'circle' &&
                    handle.holeWidth !== handle.holeHeight
                  )
                    violations.push(`Non-circular opening: ${detail}`)
                  if (
                    handle.holeWidth < 6 ||
                    handle.holeHeight < 6 ||
                    handle.holeGap < 3
                  )
                    violations.push(`Insufficient hole size or web: ${detail}`)
                  if (handle.holeHeight > handle.holeWidth)
                    violations.push(`Invalid capsule dimensions: ${detail}`)
                  const span =
                    handle.holeCount * handle.holeWidth +
                    (handle.holeCount - 1) * handle.holeGap
                  const centerY = handle.height / 2 + 2 + handle.offsetY
                  for (let hole = 0; hole < handle.holeCount; hole += 1) {
                    const centerX =
                      -span / 2 +
                      handle.holeWidth / 2 +
                      hole * (handle.holeWidth + handle.holeGap) +
                      handle.offsetX
                    for (let sample = 0; sample < 64; sample += 1) {
                      const angle = (2 * Math.PI * sample) / 64
                      const direction = Math.cos(angle)
                      const radius = handle.holeHeight / 2
                      const x =
                        centerX +
                        (Math.sign(direction) *
                          (handle.holeWidth - handle.holeHeight)) /
                          2 +
                        radius * direction
                      const y = centerY + radius * Math.sin(angle)
                      if (outerDistance(x, y, handle) > -3 + 1e-6)
                        violations.push(
                          `Opening reaches rounded outer web: ${detail}`,
                        )
                      if (y < 7 - 1e-6)
                        violations.push(
                          `Opening enters attachment shoulder: ${detail}`,
                        )
                    }
                  }
                  const limits = getHandleLimits(model, handle)
                  for (const [key, limit] of Object.entries(limits)) {
                    const value = handle[key as keyof HandleSettings]
                    if (
                      !Number.isFinite(limit.min) ||
                      !Number.isFinite(limit.max) ||
                      limit.min > limit.max
                    )
                      violations.push(`Invalid ${key} control range: ${detail}`)
                    // Circle height is controlled by its diameter; no separate height slider is shown.
                    if (key === 'holeHeight' && handle.cutout === 'circle')
                      continue
                    if (
                      typeof value !== 'number' ||
                      !Number.isFinite(value) ||
                      value < limit.min - 1e-6 ||
                      value > limit.max + 1e-6
                    )
                      violations.push(`Out-of-range ${key}: ${detail}`)
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(cases).toBe(972)
    expect(violations).toEqual([])
  })
})
