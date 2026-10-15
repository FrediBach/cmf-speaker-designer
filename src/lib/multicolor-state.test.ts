import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allowDesignSave,
  designShareUrl,
  getDesignLoadFailure,
  hasRejectedSavedDesign,
  MAX_DESIGN_JSON_BYTES,
  parseDesignJson,
  readDesign,
  STORAGE_KEY,
  validateDesign,
  type Design,
} from './design'
import { createDesignHistory, designHistoryReducer } from './design-history'
import { getDefaultMulticolorSettings } from './multicolor-settings'
import { createPatternElement, generateStripes } from './multicolor-patterns'
import { applyMulticolorPreset } from './multicolor-presets'

function storageWith(design: string | null = null) {
  const values = new Map<string, string>()
  if (design !== null) values.set(STORAGE_KEY, design)
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  }
  vi.stubGlobal('localStorage', storage)
  return storage
}

function authoredDesign(): Design {
  let multicolor = generateStripes(getDefaultMulticolorSettings('m'), {
    count: 3,
    angle: 0,
    gap: 1,
    weights: [1, 2, 1],
    colors: ['#d12f24', '#ffffff'],
  })
  multicolor = {
    ...multicolor,
    elements: [
      ...multicolor.elements,
      createPatternElement(
        'polygon',
        multicolor.frame,
        multicolor.materials[0].id,
      ),
    ],
  }
  return validateDesign({
    model: 'm',
    style: 'original',
    panelColor: '#152b40',
    knobColor: '#4a985d',
    multicolor,
  })
}

beforeEach(() => {
  vi.stubGlobal('window', {
    location: new URL('https://example.com/designer/'),
  })
  storageWith()
  readDesign()
})

afterEach(() => {
  allowDesignSave()
  vi.unstubAllGlobals()
})

describe('multicolor design compatibility and persistence', () => {
  it('adds disabled model defaults without changing legacy appearance or geometry', () => {
    const legacy = {
      model: 'm',
      style: 'original',
      panelColor: '#13b7b1',
      knobColor: '#eeeae1',
      panelExtension: 4.5,
      panelGap: 1.2,
      relief: 0.8,
    }
    const restored = parseDesignJson(JSON.stringify(legacy))
    expect(restored).toMatchObject(legacy)
    expect(restored.multicolor).toEqual(getDefaultMulticolorSettings('m'))
    expect(restored.style).toBe('original')
  })

  it('keeps color mode independent from panel shape and preserves artwork across model changes', () => {
    const design = authoredDesign()
    expect(design.multicolor.enabled).toBe(true)
    expect(design.style).toBe('original')
    const custom = validateDesign({ ...design, style: 'custom' })
    expect(custom.style).toBe('custom')
    const restored = validateDesign({
      ...custom,
      style: 'original',
      model: 's',
    })
    expect(restored.style).toBe('original')
    expect(restored.multicolor).toEqual(design.multicolor)
    expect(restored.panelColor).toBe(design.panelColor)
    expect(restored.knobColor).toBe(design.knobColor)
  })

  it.each([false, true])(
    'retains complete enabled=%s artwork in local JSON and shared fragments',
    (enabled) => {
      const initial = authoredDesign()
      const design = validateDesign({
        ...initial,
        multicolor: { ...initial.multicolor, enabled },
      })
      storageWith(JSON.stringify(design))
      expect(readDesign()).toEqual(design)
      expect(hasRejectedSavedDesign()).toBe(false)
      const url = designShareUrl(
        design,
        'https://example.com/designer/?old=1#old',
      )
      expect(url.search).toBe('')
      expect(new URLSearchParams(url.hash.slice(1)).has('design')).toBe(true)
      vi.stubGlobal('window', { location: url })
      storageWith()
      expect(readDesign()).toEqual(design)
      expect(
        parseDesignJson(JSON.stringify({ ...design, export: { version: 1 } })),
      ).toEqual(design)
    },
  )

  it('continues reading query designs and prefers an authored fragment over query/local settings', () => {
    const original = validateDesign({ model: 's', panelColor: '#aabbcc' })
    const query = designShareUrl(original, 'https://example.com/')
    expect(query.hash).toBe('')
    expect(query.searchParams.has('design')).toBe(true)
    vi.stubGlobal('window', { location: query })
    expect(readDesign()).toEqual(original)

    const design = authoredDesign()
    // Previously shared query documents remain readable even if they have artwork.
    query.search = new URLSearchParams({
      design: JSON.stringify(design),
    }).toString()
    expect(readDesign()).toEqual(design)
    query.search = new URLSearchParams({
      design: JSON.stringify(original),
    }).toString()
    query.hash = new URLSearchParams({
      design: JSON.stringify(design),
    }).toString()
    storageWith(JSON.stringify(original))
    expect(readDesign()).toEqual(design)
  })

  it.each([
    'null',
    '[]',
    '42',
    '"not a design"',
    '{ malformed',
    '{}',
    '{"unrelated":true}',
  ])('rejects invalid JSON documents: %s', (text) => {
    expect(() => parseDesignJson(text)).toThrow()
  })

  it('rejects unsupported schema and missing material references instead of importing partial artwork', () => {
    const design = authoredDesign()
    expect(() =>
      parseDesignJson(
        JSON.stringify({
          ...design,
          multicolor: { ...design.multicolor, version: 9 },
        }),
      ),
    ).toThrow(/unsupported version/)
    const invalid = structuredClone(design)
    invalid.multicolor.elements[0].materialId = 'missing-material'
    expect(() => parseDesignJson(JSON.stringify(invalid))).toThrow(
      /missing material/,
    )
    expect(design.multicolor.elements[0].materialId).not.toBe(
      'missing-material',
    )
  })

  it('retains a rejected saved document and exposes its failure until editing is explicitly allowed', () => {
    const raw = JSON.stringify({ model: 'm', multicolor: { version: 99 } })
    const storage = storageWith(raw)
    expect(readDesign()).toEqual(validateDesign({}))
    expect(hasRejectedSavedDesign()).toBe(true)
    expect(getDesignLoadFailure()).toMatch(/unsupported version/)
    expect(getDesignLoadFailure()).toMatch(/retained/)
    expect(storage.getItem(STORAGE_KEY)).toBe(raw)
    expect(storage.setItem).not.toHaveBeenCalled()
    allowDesignSave()
    expect(hasRejectedSavedDesign()).toBe(false)
    expect(storage.getItem(STORAGE_KEY)).toBe(raw)
  })

  it('rejects excess element and byte budgets without truncation or overwriting saved data', () => {
    const design = authoredDesign()
    const excess = JSON.stringify({
      ...design,
      multicolor: {
        ...design.multicolor,
        elements: Array.from({ length: 129 }, (_, index) => ({
          ...design.multicolor.elements[0],
          id: `oversized-${index}`,
        })),
      },
    })
    for (const raw of [
      excess,
      `{"note":"${'é'.repeat(MAX_DESIGN_JSON_BYTES / 2)}"}`,
    ]) {
      const storage = storageWith(raw)
      expect(() => parseDesignJson(raw)).toThrow()
      expect(readDesign().multicolor.enabled).toBe(false)
      expect(hasRejectedSavedDesign()).toBe(true)
      expect(storage.getItem(STORAGE_KEY)).toBe(raw)
      expect(storage.setItem).not.toHaveBeenCalled()
    }
    storageWith(JSON.stringify(design))
    expect(readDesign()).toEqual(design)
    expect(hasRejectedSavedDesign()).toBe(false)
    expect(getDesignLoadFailure()).toBe('')
  })
})

describe('multicolor nested history and transactions', () => {
  it('isolates polygon points, palette entries, frame and generator weights in snapshots', () => {
    const design = authoredDesign()
    const initial = createDesignHistory(design)
    const changed = designHistoryReducer(initial, {
      type: 'set',
      update: (current) => {
        const polygon = current.multicolor.elements.at(-1)!
        if (polygon.kind !== 'polygon') throw new Error('Expected polygon')
        polygon.points[0][0] += 3
        current.multicolor.materials[0].color = '#123456'
        current.multicolor.frame.centerX = 2
        current.multicolor.groups[0].generator!.weights![0] = 3
        return current
      },
    })
    expect(initial.present).toEqual(design)
    expect(changed.past[0]).toEqual(design)
    expect(changed.present.multicolor.materials[0].color).toBe('#123456')
    expect(changed.present.multicolor.frame.centerX).toBe(2)
    expect(changed.present.multicolor.groups[0].generator!.weights![0]).toBe(3)
    const undone = designHistoryReducer(changed, { type: 'undo' })
    expect(undone.present).toEqual(design)
    expect(designHistoryReducer(undone, { type: 'redo' }).present).toEqual(
      changed.present,
    )
    expect(
      designHistoryReducer(changed, {
        type: 'set',
        update: structuredClone(changed.present),
      }),
    ).toBe(changed)
  })

  it('retains every layer when toggled off, and restores both toggles with undo and redo', () => {
    const design = authoredDesign()
    const initial = createDesignHistory(design)
    const disabled = designHistoryReducer(initial, {
      type: 'set',
      update: (current) => ({
        ...current,
        multicolor: { ...current.multicolor, enabled: false },
      }),
    })
    expect(disabled.present.multicolor).toEqual({
      ...design.multicolor,
      enabled: false,
    })
    const enabled = designHistoryReducer(disabled, {
      type: 'set',
      update: (current) => ({
        ...current,
        multicolor: { ...current.multicolor, enabled: true },
      }),
    })
    expect(enabled.present).toEqual(design)
    const undone = designHistoryReducer(enabled, { type: 'undo' })
    expect(undone.present).toEqual(disabled.present)
    expect(designHistoryReducer(undone, { type: 'redo' }).present).toEqual(
      design,
    )
  })

  it('records an entire repeated drag as one undo step and drops a cancelled gesture baseline', () => {
    const design = authoredDesign()
    const initial = createDesignHistory(design)
    let dragged = designHistoryReducer(initial, { type: 'begin' })
    for (const offset of [1, 3, 8, 12]) {
      dragged = designHistoryReducer(dragged, {
        type: 'set',
        update: (current) => {
          current.multicolor.elements[0].x =
            design.multicolor.elements[0].x + offset
          return current
        },
      })
    }
    dragged = designHistoryReducer(dragged, { type: 'end' })
    expect(dragged.past).toHaveLength(1)
    expect(designHistoryReducer(dragged, { type: 'undo' }).present).toEqual(
      design,
    )

    let cancelled = designHistoryReducer(dragged, { type: 'begin' })
    cancelled = designHistoryReducer(cancelled, {
      type: 'set',
      update: (current) => {
        current.multicolor.elements[0].rotation = 45
        return current
      },
    })
    cancelled = designHistoryReducer(cancelled, {
      type: 'set',
      update: dragged.present,
    })
    cancelled = designHistoryReducer(cancelled, { type: 'end' })
    expect(cancelled.present).toEqual(dragged.present)
    expect(cancelled.past).toHaveLength(1)
  })

  it('undoes a preset and its background color as one complete operation', () => {
    const design = authoredDesign()
    const preset = applyMulticolorPreset('norway', design.multicolor)
    let state = designHistoryReducer(createDesignHistory(design), {
      type: 'begin',
    })
    state = designHistoryReducer(state, {
      type: 'set',
      update: (current) => ({ ...current, multicolor: preset.settings }),
    })
    state = designHistoryReducer(state, {
      type: 'set',
      update: (current) => ({ ...current, panelColor: preset.panelColor }),
    })
    state = designHistoryReducer(state, { type: 'end' })
    expect(state.past).toHaveLength(1)
    expect(state.present.multicolor.preset?.id).toBe('norway')
    expect(state.present.panelColor).toBe(preset.panelColor)
    expect(state.present.knobColor).toBe(design.knobColor)
    expect(designHistoryReducer(state, { type: 'undo' }).present).toEqual(
      design,
    )
  })
})
