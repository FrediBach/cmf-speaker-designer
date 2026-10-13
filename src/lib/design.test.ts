import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DESIGN,
  readDesign,
  STORAGE_KEY,
  validateDesign,
} from './design'
import { DEFAULT_KNOB_SETTINGS } from './knob-settings'
import { DEFAULT_HALO_SETTINGS } from './halo-settings'

afterEach(() => vi.unstubAllGlobals())

describe('saved and shared handle designs', () => {
  it('opens legacy links with the original handle for the selected speaker', () => {
    const oldDesign = {
      model: 'm',
      style: '2',
      panelColor: '#13b7b1',
      knobColor: '#eeeae1',
      relief: 1.2,
    }
    const restored = validateDesign(oldDesign)
    expect(restored).toMatchObject({ ...oldDesign, style: 'original' })
    expect(restored.handle).toMatchObject({ mode: 'original', height: 27 })
    expect(restored.grille.mode).toBe('original')
    expect(restored.halo).toEqual(DEFAULT_HALO_SETTINGS)
    expect(restored.knob).toEqual(DEFAULT_KNOB_SETTINGS)
    expect(validateDesign({ model: 'm', handle: null }).handle).toEqual(
      restored.handle,
    )
  })

  it.each(['1', '2', '3'])(
    'migrates legacy panel %s without inventing custom geometry',
    (style) => {
      const saved = {
        ...DEFAULT_DESIGN,
        style,
        relief: 1.5,
        handle: { ...DEFAULT_DESIGN.handle, mode: 'custom' },
        halo: { ...DEFAULT_DESIGN.halo, depth: 32, cutAngle: 40 },
        grille: { ...DEFAULT_DESIGN.grille, pattern: 'hex', size: 4 },
      }
      expect(validateDesign(saved)).toEqual({ ...saved, style: 'original' })
      for (const component of ['halo', 'grille'] as const) {
        const custom = {
          ...saved,
          [component]: { ...saved[component], mode: 'custom' },
        }
        expect(validateDesign(custom)).toEqual({ ...custom, style: 'custom' })
      }
    },
  )

  it('round-trips custom panel mode before a halo or grille is enabled', () => {
    const custom = { ...DEFAULT_DESIGN, style: 'custom' as const }
    expect(validateDesign(custom)).toEqual(custom)
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(custom) })
    expect(readDesign()).toEqual(custom)
    vi.stubGlobal('window', {
      location: {
        search: `?design=${encodeURIComponent(JSON.stringify(custom))}`,
      },
    })
    expect(readDesign()).toEqual(custom)
  })

  it.each(['halo', 'grille'] as const)(
    'selects custom panel mode for an active %s',
    (component) => {
      const custom = validateDesign({
        ...DEFAULT_DESIGN,
        [component]: { ...DEFAULT_DESIGN[component], mode: 'custom' },
      })
      expect(custom.style).toBe('custom')
      expect(custom[component].mode).toBe('custom')
    },
  )

  it('round-trips custom handle settings through local storage and a shared URL', () => {
    const custom = validateDesign({
      ...DEFAULT_DESIGN,
      handle: {
        mode: 'custom',
        height: 48,
        width: 96,
        cornerRadius: 8,
        cutout: 'circle',
        holeCount: 3,
        holeWidth: 12,
        holeGap: 8,
        offsetX: 6,
        offsetY: 3,
      },
    })
    vi.stubGlobal('window', { location: { search: '' } })
    const getItem = vi.fn((key: string) =>
      key === STORAGE_KEY ? JSON.stringify(custom) : null,
    )
    vi.stubGlobal('localStorage', { getItem })
    expect(readDesign()).toEqual(custom)

    const shared = { ...custom, handle: { ...custom.handle, height: 52 } }
    vi.stubGlobal('window', {
      location: {
        search: `?design=${encodeURIComponent(JSON.stringify(shared))}`,
      },
    })
    expect(readDesign()).toEqual(shared)
  })

  it('keeps old defaults usable when a stored record is malformed or storage is denied', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => '{invalid-json' })
    expect(readDesign()).toEqual(DEFAULT_DESIGN)
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage denied')
      },
    })
    expect(readDesign()).toEqual(DEFAULT_DESIGN)
  })

  it('restores knob shape, dimensions, and custom colors from saved and shared designs', () => {
    const design = validateDesign({
      knob: {
        style: 'fluted',
        height: 18,
        taper: 0.6,
        flutePath: 'spiral',
        facets: 8,
        fluteCount: 12,
        fluteDepth: 1,
      },
      knobColor: '#123abc',
    })
    expect(design.knob).toMatchObject({
      style: 'fluted',
      height: 18,
      taper: 0.6,
      flutePath: 'spiral',
      facets: 8,
      fluteCount: 12,
      fluteDepth: 1,
    })
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(design) })
    expect(readDesign()).toEqual(design)
    vi.stubGlobal('window', {
      location: {
        search: `?design=${encodeURIComponent(JSON.stringify(design))}`,
      },
    })
    expect(readDesign()).toEqual(design)
    expect(validateDesign({ knob: null }).knob).toEqual(DEFAULT_KNOB_SETTINGS)
    expect(validateDesign({ knob: 'invalid' }).knob).toEqual(
      DEFAULT_KNOB_SETTINGS,
    )
  })

  it('discards legacy knob diameter and rigid rotation from saved and shared designs', () => {
    const legacy = {
      ...DEFAULT_DESIGN,
      knob: { ...DEFAULT_KNOB_SETTINGS, diameter: 24, rotation: 90 },
    }
    expect(validateDesign(legacy).knob).toEqual(DEFAULT_KNOB_SETTINGS)
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(legacy) })
    expect(readDesign().knob).toEqual(DEFAULT_KNOB_SETTINGS)
    vi.stubGlobal('window', {
      location: {
        search: `?design=${encodeURIComponent(JSON.stringify(legacy))}`,
      },
    })
    expect(readDesign().knob).toEqual(DEFAULT_KNOB_SETTINGS)
    expect(readDesign().knob).not.toHaveProperty('diameter')
    expect(readDesign().knob).not.toHaveProperty('rotation')
    expect(
      validateDesign({ knob: { style: 'heart', diameter: 24, rotation: 90 } })
        .knob,
    ).toEqual(DEFAULT_KNOB_SETTINGS)
  })

  it('restores a shared grille alongside a custom handle in custom panel mode', () => {
    const custom = validateDesign({
      ...DEFAULT_DESIGN,
      model: 'm',
      style: '2',
      relief: 1.5,
      handle: { ...DEFAULT_DESIGN.handle, mode: 'custom', height: 42 },
      grille: {
        mode: 'custom',
        pattern: 'slot',
        layout: 'staggered',
        size: 3,
        spacing: 2,
        slotLength: 12,
        rotation: 35,
        thickness: 3,
        extendPattern: true,
        recessDepth: 0.8,
      },
    })
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(custom) })
    expect(readDesign()).toEqual(custom)
    vi.stubGlobal('window', {
      location: {
        search: `?design=${encodeURIComponent(JSON.stringify(custom))}`,
      },
    })
    expect(readDesign()).toEqual(custom)
    expect(custom.style).toBe('custom')
    expect(custom.handle.mode).toBe('custom')
    expect(custom.grille).toMatchObject({
      mode: 'custom',
      pattern: 'slot',
      extendPattern: true,
      recessDepth: 0.8,
    })
    expect(validateDesign({ grille: null }).grille.mode).toBe('original')
  })

  it('restores all halo settings through storage and links, including combined grilles', () => {
    const custom = validateDesign({
      ...DEFAULT_DESIGN,
      model: 'm',
      style: '1',
      halo: {
        mode: 'custom',
        outwardAngle: 25,
        depth: 32,
        thickness: 2.4,
        cutAngle: 40,
        cutRotation: 90,
        rimHeight: 2.4,
      },
      grille: { ...DEFAULT_DESIGN.grille, mode: 'custom' },
      handle: { ...DEFAULT_DESIGN.handle, mode: 'custom' },
    })
    expect(custom.halo).toEqual({
      mode: 'custom',
      outwardAngle: 25,
      depth: 32,
      thickness: 2.4,
      cutAngle: 40,
      cutRotation: 90,
      rimHeight: 2.4,
    })
    expect(custom.style).toBe('custom')
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(custom) })
    expect(readDesign()).toEqual(custom)
    vi.stubGlobal('window', {
      location: {
        search: `?design=${encodeURIComponent(JSON.stringify(custom))}`,
      },
    })
    expect(readDesign()).toEqual(custom)
    expect(validateDesign({ halo: null }).halo).toEqual(DEFAULT_HALO_SETTINGS)
    expect(validateDesign({ halo: 'invalid' }).halo).toEqual(
      DEFAULT_HALO_SETTINGS,
    )
    expect(
      validateDesign({ halo: { mode: 'custom', cutAngle: 35 } }).halo.rimHeight,
    ).toBe(0)
  })
})
