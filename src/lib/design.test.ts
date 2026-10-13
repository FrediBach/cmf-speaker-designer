import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DESIGN,
  readDesign,
  STORAGE_KEY,
  validateDesign,
} from './design'

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
    expect(restored).toMatchObject(oldDesign)
    expect(restored.handle).toMatchObject({ mode: 'original', height: 27 })
    expect(restored.grille.mode).toBe('original')
    expect(validateDesign({ model: 'm', handle: null }).handle).toEqual(
      restored.handle,
    )
  })

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

  it('restores a shared grille alongside a custom handle and the saved factory style', () => {
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
    expect(custom.style).toBe('2')
    expect(custom.handle.mode).toBe('custom')
    expect(custom.grille).toMatchObject({
      mode: 'custom',
      pattern: 'slot',
      extendPattern: true,
      recessDepth: 0.8,
    })
    expect(validateDesign({ grille: null }).grille.mode).toBe('original')
  })
})
