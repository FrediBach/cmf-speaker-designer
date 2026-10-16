import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DESIGN,
  designShareUrl,
  parseDesignJson,
  readDesign,
  STORAGE_KEY,
  validateDesign,
} from './design'
import { DEFAULT_KNOB_SETTINGS } from './knob-settings'
import { DEFAULT_HALO_SETTINGS } from './halo-settings'
import { DEFAULT_RACE_STRIPE_SETTINGS } from './race-stripe-settings'
import type { SvgCutout } from './svg-cutout'

afterEach(() => vi.unstubAllGlobals())

describe('power button colors', () => {
  it.each(['s', 'm'] as const)(
    'preserves an independent custom color for speaker %s through storage, sharing, and JSON import',
    (model) => {
      const design = validateDesign({
        ...DEFAULT_DESIGN,
        model,
        panelColor: '#123abc',
        powerButtonColor: '#A47Ce1',
        knobColor: '#abcdef',
      })
      expect(design).toMatchObject({
        panelColor: '#123abc',
        powerButtonColor: '#A47Ce1',
        knobColor: '#abcdef',
      })
      const serialized = JSON.stringify(design)
      expect(parseDesignJson(serialized)).toEqual(design)
      vi.stubGlobal('window', { location: { search: '' } })
      vi.stubGlobal('localStorage', { getItem: () => serialized })
      expect(readDesign()).toEqual(design)
      vi.stubGlobal('window', {
        location: designShareUrl(design, 'https://example.com/designer/'),
      })
      expect(readDesign()).toEqual(design)
      expect(
        validateDesign({ ...design, panelColor: '#e4b8b4' }).powerButtonColor,
      ).toBe('#A47Ce1')
    },
  )

  it('preserves the original panel-matched button color when importing legacy designs', () => {
    for (const model of ['s', 'm']) {
      const restored = parseDesignJson(
        JSON.stringify({ model, panelColor: '#13b7b1' }),
      )
      expect(restored.powerButtonColor).toBe('#13b7b1')
      expect(restored.panelColor).toBe('#13b7b1')
    }
  })

  it('falls back to a valid panel color or the default for missing and malformed colors', () => {
    expect(DEFAULT_DESIGN.powerButtonColor).toBe('#f45427')
    for (const powerButtonColor of [
      undefined,
      null,
      'red',
      '#123',
      '#12345678',
      '#zzzzzz',
      1,
      {},
    ]) {
      expect(
        validateDesign({ panelColor: '#5573ce', powerButtonColor })
          .powerButtonColor,
      ).toBe('#5573ce')
      expect(
        validateDesign({ panelColor: 'invalid', powerButtonColor })
          .powerButtonColor,
      ).toBe(DEFAULT_DESIGN.powerButtonColor)
      expect(validateDesign({ powerButtonColor }).powerButtonColor).toBe(
        DEFAULT_DESIGN.powerButtonColor,
      )
    }
  })

  it('recognizes a design containing only the power button color', () => {
    expect(parseDesignJson('{"powerButtonColor":"#abcdef"}')).toEqual({
      ...DEFAULT_DESIGN,
      powerButtonColor: '#abcdef',
    })
  })
})

describe('speaker body grille colors', () => {
  it.each(['black', 'orange', 'turquoise'] as const)(
    'preserves a %s grille through storage, sharing, and JSON import independently of printable settings',
    (bodyGrilleColor) => {
      const design = validateDesign({
        ...DEFAULT_DESIGN,
        model: 'm',
        bodyGrilleColor,
        panelColor: '#123abc',
        knobColor: '#abcdef',
        grille: { ...DEFAULT_DESIGN.grille, mode: 'custom', pattern: 'hex' },
      })
      expect(design).toMatchObject({
        bodyColor: 'black',
        bodyGrilleColor,
        panelColor: '#123abc',
        knobColor: '#abcdef',
        grille: { mode: 'custom', pattern: 'hex' },
      })
      const serialized = JSON.stringify(design)
      expect(parseDesignJson(serialized)).toEqual(design)
      vi.stubGlobal('window', { location: { search: '' } })
      vi.stubGlobal('localStorage', { getItem: () => serialized })
      expect(readDesign()).toEqual(design)
      vi.stubGlobal('window', {
        location: designShareUrl(design, 'https://example.com/designer/'),
      })
      expect(readDesign()).toEqual(design)
    },
  )

  it.each(['black', 'orange', 'turquoise'])(
    'normalizes a gray body with a %s grille to black on import',
    (bodyGrilleColor) => {
      const design = parseDesignJson(
        JSON.stringify({
          ...DEFAULT_DESIGN,
          bodyColor: 'gray',
          bodyGrilleColor,
        }),
      )
      expect(design).toEqual({
        ...DEFAULT_DESIGN,
        bodyColor: 'gray',
        bodyGrilleColor: 'black',
      })
    },
  )

  it('keeps legacy grilles black and rejects unsupported colors', () => {
    expect(DEFAULT_DESIGN.bodyGrilleColor).toBe('black')
    for (const bodyGrilleColor of [
      undefined,
      null,
      'gray',
      'Orange',
      '#f45427',
      1,
      {},
    ]) {
      expect(validateDesign({ bodyGrilleColor }).bodyGrilleColor).toBe('black')
    }
    for (const bodyColor of ['black', 'gray']) {
      expect(
        parseDesignJson(JSON.stringify({ model: 's', bodyColor })),
      ).toEqual({
        ...DEFAULT_DESIGN,
        bodyColor,
        bodyGrilleColor: 'black',
      })
    }
  })
})

describe('saved and shared race stripes', () => {
  it('keeps legacy designs unchanged when stripe settings are absent or malformed', () => {
    for (const raceStripes of [undefined, null, 'invalid', 1, {}]) {
      const restored = validateDesign({ model: 'm', raceStripes })
      expect(restored.raceStripes).toEqual(DEFAULT_RACE_STRIPE_SETTINGS)
      expect(restored.style).toBe('original')
    }
  })

  it.each([false, true])(
    'restores stripes enabled=%s and retained dimensions through storage and shared links',
    (enabled) => {
      const design = validateDesign({
        ...DEFAULT_DESIGN,
        raceStripes: { enabled, count: 3, width: 8, gap: 5 },
      })
      expect(design.raceStripes).toEqual({
        enabled,
        count: 3,
        width: 8,
        gap: 5,
      })
      expect(design.style).toBe(enabled ? 'custom' : 'original')
      vi.stubGlobal('window', { location: { search: '' } })
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(design) })
      expect(readDesign()).toEqual(design)
      vi.stubGlobal('window', {
        location: designShareUrl(design, 'https://example.com/designer/'),
      })
      expect(readDesign()).toEqual(design)
    },
  )
})

describe('panel extension', () => {
  it('keeps legacy designs at the original width and rejects malformed extensions', () => {
    expect(DEFAULT_DESIGN.panelExtension).toBe(0)
    for (const panelExtension of [undefined, null, '5', NaN, Infinity, {}]) {
      expect(validateDesign({ panelExtension }).panelExtension).toBe(0)
    }
    expect(validateDesign({ model: 'm' }).panelExtension).toBe(0)
  })

  it.each([
    [-1, 0],
    [0, 0],
    [3.74, 3.7],
    [3.76, 3.8],
    [10, 10],
    [15, 10],
  ])('normalizes %s mm to %s mm per side', (panelExtension, expected) => {
    expect(validateDesign({ panelExtension }).panelExtension).toBe(expected)
  })

  it('restores extended panels from storage and shared URLs', () => {
    const design = validateDesign({ ...DEFAULT_DESIGN, panelExtension: 7.5 })
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(design) })
    expect(readDesign()).toEqual(design)
    vi.stubGlobal('window', {
      location: designShareUrl(design, 'https://example.com/designer/'),
    })
    expect(readDesign()).toEqual(design)
  })
})

describe('split panel assembly', () => {
  it('requires an explicit opt-in and preserves legacy one-piece designs', () => {
    expect(DEFAULT_DESIGN.panelSplit).toBe(false)
    for (const panelSplit of [undefined, null, false, 'true', 1, {}, []])
      expect(validateDesign({ panelSplit }).panelSplit).toBe(false)
    expect(parseDesignJson('{"model":"m"}').panelSplit).toBe(false)
    expect(parseDesignJson('{"panelSplit":true}').panelSplit).toBe(true)
  })

  it.each(['s', 'm'] as const)(
    'preserves the %s panel assembly choice through storage, sharing, and JSON import',
    (model) => {
      const design = validateDesign({
        ...DEFAULT_DESIGN,
        model,
        panelSplit: true,
        panelGap: 3.5,
        panelExtension: 7.5,
      })
      expect(design.panelSplit).toBe(true)
      const serialized = JSON.stringify(design)
      expect(parseDesignJson(serialized)).toEqual(design)
      vi.stubGlobal('window', { location: { search: '' } })
      vi.stubGlobal('localStorage', { getItem: () => serialized })
      expect(readDesign()).toEqual(design)
      vi.stubGlobal('window', {
        location: designShareUrl(design, 'https://example.com/designer/'),
      })
      expect(readDesign()).toEqual(design)
    },
  )
})

describe('panel gap', () => {
  it('keeps legacy panels flush and rejects malformed gaps', () => {
    expect(DEFAULT_DESIGN.panelGap).toBe(0)
    for (const panelGap of [
      undefined,
      null,
      '3',
      true,
      NaN,
      Infinity,
      -Infinity,
      {},
    ]) {
      expect(validateDesign({ panelGap }).panelGap).toBe(0)
    }
    expect(validateDesign({ model: 'm' }).panelGap).toBe(0)
  })

  it.each([
    [-1, 0],
    [0, 0],
    [1.24, 1.2],
    [1.26, 1.3],
    [5, 5],
    [10, 5],
  ])('normalizes a %s mm gap to %s mm', (panelGap, expected) => {
    expect(validateDesign({ panelGap }).panelGap).toBe(expected)
  })

  it('restores panel spacing independently of side extension from storage and shared URLs', () => {
    const design = validateDesign({
      ...DEFAULT_DESIGN,
      panelExtension: 7.5,
      panelGap: 3.5,
    })
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(design) })
    expect(readDesign()).toEqual(design)
    vi.stubGlobal('window', {
      location: designShareUrl(design, 'https://example.com/designer/'),
    })
    expect(readDesign()).toEqual(design)
  })
})

describe('saved and shared handle designs', () => {
  it.each(['straight', 'outward', 'inward'] as const)(
    'restores the %s top profile and retained hair settings through storage and shared links',
    (topShape) => {
      const design = validateDesign({
        ...DEFAULT_DESIGN,
        model: 'm',
        handle: {
          ...DEFAULT_DESIGN.handle,
          mode: 'custom',
          height: 56,
          width: 90,
          topAngle: -12,
          topShape,
          topCurve: 9,
          cutout: 'slits',
          holeCount: 5,
          holeWidth: 5,
          holeHeight: 23,
          holeGap: 8,
          legoStuds: true,
        },
      })
      expect(design.handle).toMatchObject({
        topAngle: -12,
        topShape,
        topCurve: 9,
        holeCount: 5,
        legoStuds: true,
      })
      vi.stubGlobal('window', { location: { search: '' } })
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(design) })
      expect(readDesign()).toEqual(design)
      vi.stubGlobal('window', {
        location: designShareUrl(design, 'https://example.com/designer/'),
      })
      expect(readDesign()).toEqual(design)

      const original = validateDesign({
        ...design,
        handle: { ...design.handle, mode: 'original' },
      })
      expect(original.handle).toEqual({ ...design.handle, mode: 'original' })
    },
  )

  it('restores legacy and malformed top settings as a flat straight top', () => {
    for (const value of [undefined, null, 'invalid', true, {}, NaN, Infinity]) {
      const restored = validateDesign({
        handle: {
          mode: 'custom',
          topShape: value,
          topAngle: value,
          topCurve: value,
        },
      })
      expect(restored.handle).toMatchObject({
        topShape: 'straight',
        topAngle: 0,
        topCurve: 10,
      })
    }
  })

  it.each(['s', 'm'] as const)(
    'restores five top-open hair slits from saved and shared %s designs',
    (model) => {
      const handle = {
        mode: 'custom',
        cutout: 'slits',
        height: 35,
        width: 85,
        cornerRadius: 8,
        holeCount: 5,
        holeWidth: 5,
        holeHeight: 23,
        holeGap: 8,
        offsetX: 0,
        offsetY: 0,
      }
      const design = validateDesign({ ...DEFAULT_DESIGN, model, handle })
      expect(design.handle).toMatchObject(handle)
      vi.stubGlobal('window', { location: { search: '' } })
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(design) })
      expect(readDesign()).toEqual(design)
      vi.stubGlobal('window', {
        location: designShareUrl(design, 'https://example.com/designer/'),
      })
      expect(readDesign()).toEqual(design)
    },
  )

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
    expect(restored.bodyColor).toBe('black')
    expect(restored.handle).toMatchObject({
      mode: 'original',
      height: 27,
      legoStuds: false,
      topAngle: 0,
      topShape: 'straight',
      topCurve: 10,
    })
    expect(restored.grille.mode).toBe('original')
    expect(restored.halo).toEqual(DEFAULT_HALO_SETTINGS)
    expect(restored.knob).toEqual(DEFAULT_KNOB_SETTINGS)
    expect(validateDesign({ model: 'm', handle: null }).handle).toEqual(
      restored.handle,
    )
  })

  it.each(['black', 'gray'] as const)(
    'restores a %s body through storage and shared links independently of panel color',
    (bodyColor) => {
      const design = validateDesign({
        ...DEFAULT_DESIGN,
        model: 'm',
        bodyColor,
        panelColor: '#123abc',
      })
      expect(design.bodyColor).toBe(bodyColor)
      expect(design.panelColor).toBe('#123abc')
      vi.stubGlobal('window', { location: { search: '' } })
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(design) })
      expect(readDesign()).toEqual(design)
      vi.stubGlobal('window', {
        location: {
          search: `?design=${encodeURIComponent(JSON.stringify(design))}`,
        },
      })
      expect(readDesign()).toEqual(design)
    },
  )

  it('defaults missing and unsupported body colors to black', () => {
    expect(DEFAULT_DESIGN.bodyColor).toBe('black')
    for (const bodyColor of [undefined, null, 'white', '#808080', 1, {}]) {
      expect(validateDesign({ bodyColor }).bodyColor).toBe('black')
    }
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

  it.each([false, true])(
    'round-trips custom handle settings with studs %s through storage and a shared URL',
    (legoStuds) => {
      const custom = validateDesign({
        ...DEFAULT_DESIGN,
        handle: {
          mode: 'custom',
          legoStuds,
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
      expect(custom.handle.legoStuds).toBe(legoStuds)
      vi.stubGlobal('window', { location: { search: '' } })
      const getItem = vi.fn((key: string) =>
        key === STORAGE_KEY ? JSON.stringify(custom) : null,
      )
      vi.stubGlobal('localStorage', { getItem })
      expect(readDesign()).toEqual(custom)

      const shared = {
        ...custom,
        handle: { ...custom.handle, height: 52, legoStuds: !legoStuds },
      }
      const url = designShareUrl(shared, 'https://example.com/designer/')
      vi.stubGlobal('window', { location: url })
      expect(readDesign()).toEqual(shared)
    },
  )

  it('keeps studs disabled in legacy handles and rejects non-boolean stored values', () => {
    for (const legoStuds of [undefined, null, 'true', 'false', 0, 1, {}]) {
      const saved = { handle: { mode: 'custom', legoStuds } }
      vi.stubGlobal('window', { location: { search: '' } })
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(saved) })
      expect(readDesign().handle.legoStuds).toBe(false)
    }
  })

  it('preserves uploaded SVG geometry and fill rules in saved and shared handles', () => {
    const svgCutout: SvgCutout = {
      name: 'custom-opening.svg',
      aspectRatio: 2,
      paths: [
        {
          fillRule: 'evenodd',
          contours: [
            [
              [-0.5, -0.5],
              [0.5, -0.5],
              [0.5, 0.5],
              [-0.5, 0.5],
            ],
            [
              [-0.2, -0.2],
              [0.2, -0.2],
              [0, 0.2],
            ],
          ],
        },
        {
          fillRule: 'nonzero',
          contours: [
            [
              [-0.1, -0.1],
              [0.1, -0.1],
              [0, 0.1],
            ],
          ],
        },
      ],
    }
    const design = validateDesign({
      ...DEFAULT_DESIGN,
      handle: {
        ...DEFAULT_DESIGN.handle,
        mode: 'custom',
        cutout: 'svg',
        height: 48,
        width: 96,
        holeWidth: 36,
        holeHeight: 18,
        svgCutout,
      },
    })
    expect(design.handle.cutout).toBe('svg')
    expect(design.handle.svgCutout).toEqual(svgCutout)
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(design) })
    expect(readDesign()).toEqual(design)
    vi.stubGlobal('window', {
      location: {
        search: `?design=${encodeURIComponent(JSON.stringify(design))}`,
      },
    })
    expect(readDesign()).toEqual(design)
    svgCutout.paths[0].contours[0][0][0] = -0.25
    expect(design.handle.svgCutout!.paths[0].contours[0][0][0]).toBe(-0.5)
  })

  it('shares designs without uploaded artwork through the existing query format', () => {
    const url = designShareUrl(
      DEFAULT_DESIGN,
      'https://example.com/designer/?design=old&unrelated=value#design=old',
    )
    expect(url.origin).toBe('https://example.com')
    expect(url.pathname).toBe('/designer/')
    expect(url.hash).toBe('')
    expect(Array.from(url.searchParams.keys())).toEqual(['design'])
    expect(JSON.parse(url.searchParams.get('design')!)).toEqual(DEFAULT_DESIGN)
    vi.stubGlobal('window', { location: url })
    expect(readDesign()).toEqual(DEFAULT_DESIGN)
  })

  it.each(['svg', 'slot'] as const)(
    'keeps a maximum-size SVG out of HTTP query strings with the %s cutout selected',
    (cutout) => {
      const design = validateDesign({
        ...DEFAULT_DESIGN,
        handle: {
          ...DEFAULT_DESIGN.handle,
          mode: 'custom',
          cutout,
          svgCutout: {
            name: 'Large # & + cutout.svg',
            aspectRatio: 1,
            paths: [
              {
                fillRule: 'nonzero',
                contours: [
                  Array.from({ length: 4096 }, (_, index) => {
                    const angle = (index / 4096) * 2 * Math.PI
                    return [Math.cos(angle) / 2, Math.sin(angle) / 2]
                  }),
                ],
              },
            ],
          },
        },
      })
      expect(design.handle.svgCutout).not.toBeNull()
      const url = designShareUrl(
        design,
        'https://example.com/designer/?design=old',
      )
      expect(url.search).toBe('')
      expect(url.hash.length).toBeGreaterThan(100_000)
      expect(
        JSON.parse(new URLSearchParams(url.hash.slice(1)).get('design')!),
      ).toEqual(design)
      vi.stubGlobal('window', { location: url })
      vi.stubGlobal('localStorage', {
        getItem: () => JSON.stringify(DEFAULT_DESIGN),
      })
      expect(readDesign()).toEqual(design)

      const changed = validateDesign({ ...design, panelColor: '#123abc' })
      const changedUrl = designShareUrl(changed, url.href)
      expect(changedUrl.search).toBe('')
      vi.stubGlobal('window', { location: changedUrl })
      expect(readDesign()).toEqual(changed)

      const removed = validateDesign({
        ...changed,
        handle: { ...changed.handle, svgCutout: null },
      })
      const removedUrl = designShareUrl(removed, changedUrl.href)
      expect(removedUrl.hash).toBe('')
      expect(removedUrl.searchParams.has('design')).toBe(true)
      vi.stubGlobal('window', { location: removedUrl })
      expect(readDesign()).toEqual(removed)
    },
  )

  it('prefers a shared fragment over legacy query data and local storage', () => {
    const design = validateDesign({ ...DEFAULT_DESIGN, model: 'm' })
    const url = designShareUrl(DEFAULT_DESIGN, 'https://example.com/')
    url.hash = new URLSearchParams({
      design: JSON.stringify(design),
    }).toString()
    vi.stubGlobal('window', { location: url })
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify(DEFAULT_DESIGN),
    })
    expect(readDesign()).toEqual(design)
  })

  it('opens legacy handles with no SVG data and discards malformed SVG payloads', () => {
    expect(
      validateDesign({ handle: { mode: 'custom', cutout: 'slot' } }).handle,
    ).toMatchObject({ mode: 'custom', cutout: 'slot', svgCutout: null })
    for (const svgCutout of [null, 'invalid', {}, { paths: [] }]) {
      expect(
        validateDesign({ handle: { mode: 'custom', cutout: 'svg', svgCutout } })
          .handle.svgCutout,
      ).toBeNull()
    }
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

  it('restores text knob characters, font, weight, and dimensions from JSON, storage, and share links', () => {
    const design = validateDesign({
      knob: {
        style: 'text',
        text: 'B8',
        fontId: 'space-mono',
        fontWeight: 700,
        height: 20,
        taper: 0.5,
      },
    })
    expect(design.knob).toMatchObject({
      style: 'text',
      text: 'B8',
      fontId: 'space-mono',
      fontWeight: 700,
      height: 20,
      taper: 0.5,
    })
    const serialized = JSON.stringify(design)
    expect(parseDesignJson(serialized)).toEqual(design)
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => serialized })
    expect(readDesign()).toEqual(design)
    vi.stubGlobal('window', {
      location: designShareUrl(design, 'https://example.com/designer/'),
    })
    expect(readDesign()).toEqual(design)
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
        waveShape: 'triangle',
        waveAmplitude: 5.5,
        waveFrequency: 4.25,
        wavePhase: 135,
        waveSeamless: false,
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
      waveShape: 'triangle',
      waveAmplitude: 5.5,
      waveFrequency: 4.25,
      wavePhase: 135,
      waveSeamless: false,
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

  it('restores legacy halo designs with wave modulation disabled', () => {
    const legacyHalo = {
      mode: 'custom',
      outwardAngle: 15,
      depth: 20,
      thickness: 3,
      cutAngle: 25,
      cutRotation: 180,
      rimHeight: 1,
    }
    const legacy = { ...DEFAULT_DESIGN, halo: legacyHalo }
    vi.stubGlobal('window', { location: { search: '' } })
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(legacy) })
    expect(readDesign().halo).toEqual({
      ...DEFAULT_HALO_SETTINGS,
      ...legacyHalo,
    })
    vi.stubGlobal('window', {
      location: {
        search: `?design=${encodeURIComponent(JSON.stringify(legacy))}`,
      },
    })
    expect(readDesign().halo).toEqual({
      ...DEFAULT_HALO_SETTINGS,
      ...legacyHalo,
    })
  })
})
