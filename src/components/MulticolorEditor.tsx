import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BufferGeometry } from 'three'
import {
  ArrowDown,
  ArrowUp,
  Circle,
  Copy,
  Eye,
  EyeOff,
  FileUp,
  Plus,
  RectangleHorizontal,
  Shapes,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import {
  MULTICOLOR_LIMITS,
  PATTERN_FONTS,
  getDefaultMulticolorSettings,
  normalizeMulticolorSettings,
  type MulticolorSettings,
  type PatternElement,
  type PatternFrame,
  type PatternKind,
  type PatternFontId,
} from '@/lib/multicolor-settings'
import {
  createPatternElement,
  createPatternId,
  fitMulticolorArtwork,
  generateStripes,
  getElementContours,
} from '@/lib/multicolor-patterns'
import type { ImportedSvgShape } from '@/lib/multicolor-vector'
import {
  applyMulticolorPreset,
  MULTICOLOR_PRESETS,
} from '@/lib/multicolor-presets'
import { useNumericDraft } from '@/lib/use-numeric-draft'
import { MulticolorCanvas } from './MulticolorCanvas'
import './multicolor.css'

interface Props {
  value: MulticolorSettings
  onChange: (settings: MulticolorSettings) => void
  panelColor: string
  onPanelColorChange: (color: string) => void
  model: 's' | 'm'
  geometry?: BufferGeometry | null
  onBeginTransaction?: () => void
  onEndTransaction?: () => void
}

function NumberField({
  label,
  value,
  onChange,
  min = -10_000,
  max = 10_000,
  step = 0.1,
  unit = 'mm',
}: {
  label: string
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}) {
  const [draft, setDraft] = useNumericDraft(value)
  const cancelled = useRef(false)
  const dirty = useRef(false)
  return (
    <label className="multicolor-number">
      <span>{label}</span>
      <span className="multicolor-input-unit">
        <input
          type="number"
          inputMode={step === 1 ? 'numeric' : 'decimal'}
          aria-label={unit ? `${label} (${unit})` : label}
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            dirty.current = true
            setDraft(event.target.value)
          }}
          onFocus={() => {
            cancelled.current = false
            dirty.current = false
          }}
          onBlur={() => {
            const parsed = Number(draft)
            setDraft(String(Number(value.toFixed(2))))
            // Formatting is for display only. Tabbing through a generated
            // coordinate must not round its stored precision or create undo.
            if (
              dirty.current &&
              !cancelled.current &&
              draft.trim() &&
              Number.isFinite(parsed) &&
              parsed !== Number(value.toFixed(2))
            ) {
              const next = Math.min(
                max,
                Math.max(min, step === 1 ? Math.round(parsed) : parsed),
              )
              if (next !== value) onChange(next)
            }
            cancelled.current = false
            dirty.current = false
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              cancelled.current = true
              event.currentTarget.blur()
              event.stopPropagation()
            }
          }}
        />
        {unit && <small>{unit}</small>}
      </span>
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
  maxLength = MULTICOLOR_LIMITS.nameLength,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  maxLength?: number
}) {
  const [previous, setPrevious] = useState(value)
  const [draft, setDraft] = useState(value)
  const cancelled = useRef(false)
  if (value !== previous) {
    setPrevious(value)
    setDraft(value)
  }
  return (
    <label className="multicolor-text-field">
      <span>{label}</span>
      <input
        value={draft}
        maxLength={maxLength}
        onFocus={() => {
          cancelled.current = false
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft.trim()
          setDraft(value)
          if (!cancelled.current && next && next !== value) onChange(next)
          cancelled.current = false
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            cancelled.current = true
            event.stopPropagation()
            event.currentTarget.blur()
          }
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (color: string) => void
}) {
  const [previous, setPrevious] = useState(value)
  const [draft, setDraft] = useState(value)
  const [invalid, setInvalid] = useState(false)
  if (value !== previous) {
    setPrevious(value)
    setDraft(value)
  }
  return (
    <div className="multicolor-color-field">
      <input
        type="color"
        value={value}
        aria-label={`${label} color`}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        aria-label={`${label} hex color`}
        aria-invalid={invalid || undefined}
        value={draft}
        spellCheck={false}
        maxLength={7}
        onChange={(event) => {
          setDraft(event.target.value)
          setInvalid(false)
        }}
        onBlur={() => {
          const hex = draft.startsWith('#') ? draft : `#${draft}`
          if (/^#[a-f0-9]{6}$/i.test(hex)) {
            if (hex.toLowerCase() !== value.toLowerCase())
              onChange(hex.toLowerCase())
            setDraft(hex.toLowerCase())
            setInvalid(false)
          } else {
            setDraft(value)
            setInvalid(true)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(value)
            setInvalid(false)
            event.stopPropagation()
          }
        }}
      />
      {invalid && (
        <span className="multicolor-color-error">Use six hex digits.</span>
      )}
    </div>
  )
}

function boundsOf(element: PatternElement) {
  const points = getElementContours(element).flat()
  const xs = points.map(([x]) => x),
    ys = points.map(([, y]) => y)
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  }
}

function panelFrame(
  geometry: BufferGeometry | null | undefined,
  model: 's' | 'm',
): PatternFrame {
  if (!geometry) return getDefaultMulticolorSettings(model).frame
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  if (!box || box.isEmpty()) return getDefaultMulticolorSettings(model).frame
  return {
    centerX: (box.min.x + box.max.x) / 2,
    centerY: (box.min.y + box.max.y) / 2,
    width: box.max.x - box.min.x,
    height: box.max.y - box.min.y,
  }
}

export function MulticolorEditor({
  value,
  onChange,
  panelColor,
  onPanelColorChange,
  model,
  geometry,
  onBeginTransaction,
  onEndTransaction,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [presetId, setPresetId] = useState(value.preset?.id ?? 'france')
  const [layout, setLayout] = useState<'panel' | 'proportional'>(
    value.preset?.layout ?? 'panel',
  )
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [generatorGroupId, setGeneratorGroupId] = useState<string | null>(null)
  const [stripeCount, setStripeCount] = useState(3)
  const [stripeAngle, setStripeAngle] = useState(0)
  const [stripeGap, setStripeGap] = useState(0)
  const [stripeWeights, setStripeWeights] = useState('')
  const [stripeColors, setStripeColors] = useState('#f45427, #eeeae1, #303538')
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({})
  const [importingSvg, setImportingSvg] = useState(false)
  const svgInput = useRef<HTMLInputElement>(null)
  const svgReplacementId = useRef<string | null>(null)
  const svgRequest = useRef(0)
  const latestDocument = useRef({ value, model })
  useLayoutEffect(() => {
    latestDocument.current = { value, model }
  }, [value, model])
  useEffect(
    () => () => {
      svgRequest.current += 1
    },
    [],
  )
  const selected = value.elements.find((element) => element.id === selectedId)
  const selectedGroup = selected?.groupId
    ? value.groups.find((group) => group.id === selected.groupId)
    : undefined
  const generatorGroup = value.groups.find(
    (group) => group.id === generatorGroupId,
  )
  const materials = [
    { id: 'base', name: 'Background', color: panelColor },
    ...value.materials,
  ]
  const assignedIds = new Set(
    value.elements
      .filter((element) => element.visible)
      .map((element) => element.materialId),
  )
  assignedIds.add('base')
  const materialColor = (materialId: string) =>
    materials.find((material) => material.id === materialId)?.color ??
    panelColor

  const commit = (settings: MulticolorSettings): boolean => {
    try {
      const next = normalizeMulticolorSettings(settings, model)
      onChange(next)
      setError(null)
      return true
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'This edit could not be applied.',
      )
      return false
    }
  }
  const attempt = (operation: () => void) => {
    onBeginTransaction?.()
    try {
      operation()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'This edit could not be applied.',
      )
    } finally {
      onEndTransaction?.()
    }
  }
  const editElement = (next: PatternElement) =>
    commit({
      ...value,
      elements: value.elements.map((element) =>
        element.id === next.id ? next : element,
      ),
    })
  const addShape = (kind: PatternKind, imported?: ImportedSvgShape) =>
    attempt(() => {
      let materialId = selected?.materialId ?? value.materials[0]?.id
      let next = value
      if (!materialId || materialId === 'base') {
        materialId = value.materials[0]?.id ?? createPatternId('material')
        if (!value.materials.length)
          next = {
            ...value,
            materials: [
              {
                id: materialId,
                name: 'Color 1',
                color:
                  panelColor.toLowerCase() === '#ffffff'
                    ? '#303538'
                    : '#ffffff',
              },
            ],
          }
      }
      const shape: PatternElement = imported
        ? {
            ...createPatternElement('svg', value.frame, materialId),
            ...imported,
            kind: 'svg',
            name:
              imported.sourceName
                .replace(/\.svg$/i, '')
                .slice(0, MULTICOLOR_LIMITS.nameLength) || 'SVG',
          }
        : createPatternElement(kind, value.frame, materialId)
      if (commit({ ...next, elements: [...value.elements, shape] })) {
        setSelectedId(shape.id)
        setAnnouncement(`${shape.name} added.`)
      }
    })
  const chooseSvg = (replacementId: string | null = null) => {
    svgReplacementId.current = replacementId
    svgInput.current?.click()
  }
  const readSvg = async (file: File) => {
    const request = ++svgRequest.current
    const replacementId = svgReplacementId.current
    const baseline = value
    setImportingSvg(true)
    try {
      if (file.size > MULTICOLOR_LIMITS.svgBytes)
        throw new Error(
          `SVG files must be ${Math.floor(MULTICOLOR_LIMITS.svgBytes / 1024)} KB or smaller.`,
        )
      const source = await file.text()
      if (request !== svgRequest.current) return
      // File reads can finish after an undo, preset change, or another edit.
      // Never replace a newer document with the snapshot from the file picker.
      if (
        latestDocument.current.value !== baseline ||
        latestDocument.current.model !== model
      )
        throw new Error(
          'The artwork changed while the SVG was loading. Please import it again.',
        )
      const { importSvgShape } = await import('@/lib/multicolor-vector')
      const imported = await importSvgShape(source, file.name, value.frame)
      if (request !== svgRequest.current) return
      if (
        latestDocument.current.value !== baseline ||
        latestDocument.current.model !== model
      )
        throw new Error(
          'The artwork changed while the SVG was loading. Please import it again.',
        )
      if (replacementId) {
        const replacement = value.elements.find(
          (element) => element.id === replacementId,
        )
        if (replacement?.kind !== 'svg')
          throw new Error('The SVG layer to replace is no longer available.')
        attempt(() => {
          if (
            editElement({
              ...replacement,
              ...imported,
              width: replacement.width,
              height: (replacement.width * imported.height) / imported.width,
            })
          ) {
            setSelectedId(replacement.id)
            setAnnouncement(`${replacement.name} SVG replaced.`)
          }
        })
      } else {
        addShape('svg', imported)
      }
    } catch (cause) {
      if (request === svgRequest.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'This SVG could not be imported.',
        )
    } finally {
      if (request === svgRequest.current) setImportingSvg(false)
    }
  }
  const duplicate = () => {
    if (!selected) return
    const copy: PatternElement = {
      ...selected,
      id: createPatternId(),
      name: `${selected.name.slice(0, 70)} copy`,
      x: selected.x + 3,
      y: selected.y - 3,
    }
    delete copy.groupId
    if (copy.kind === 'polygon')
      copy.points = copy.points.map(([x, y]) => [x, y])
    if (copy.kind === 'svg')
      copy.contours = copy.contours.map((contour) =>
        contour.map(([x, y]) => [x, y]),
      )
    if (commit({ ...value, elements: [...value.elements, copy] })) {
      setSelectedId(copy.id)
      setAnnouncement(`${selected.name} duplicated.`)
    }
  }
  const remove = () => {
    if (!selected) return
    const index = value.elements.findIndex(
      (element) => element.id === selected.id,
    )
    const elements = value.elements.filter(
      (element) => element.id !== selected.id,
    )
    if (commit({ ...value, elements })) {
      setSelectedId(elements[Math.min(index, elements.length - 1)]?.id ?? null)
      setAnnouncement(`${selected.name} deleted.`)
    }
  }
  const reorder = (id: string, direction: -1 | 1) => {
    const elements = [...value.elements]
    const index = elements.findIndex((element) => element.id === id),
      target = index + direction
    if (target < 0 || target >= elements.length) return
    ;[elements[index], elements[target]] = [elements[target], elements[index]]
    commit({ ...value, elements })
  }
  const applyPreset = (refit = false) =>
    attempt(() => {
      const current = refit
        ? { ...value, frame: panelFrame(geometry, model) }
        : value
      const result = applyMulticolorPreset(presetId, current, layout)
      if (commit(result.settings)) {
        onPanelColorChange(result.panelColor)
        setSelectedId(result.settings.elements.at(-1)?.id ?? null)
        setAnnouncement(
          `${MULTICOLOR_PRESETS.find((preset) => preset.id === presetId)?.name ?? 'Preset'} applied. All shapes are editable.`,
        )
      }
    })
  const generate = () =>
    attempt(() => {
      const oldGroup = value.groups.find(
        (group) => group.id === generatorGroupId,
      )
      const oldElements = oldGroup
        ? value.elements.filter((element) => element.groupId === oldGroup.id)
        : []
      const current = oldGroup
        ? {
            ...value,
            elements: value.elements.filter(
              (element) => element.groupId !== oldGroup.id,
            ),
            groups: value.groups.filter((group) => group.id !== oldGroup.id),
          }
        : value
      const colors = stripeColors.trim()
        ? stripeColors.split(/[\s,;]+/).filter(Boolean)
        : undefined
      const weights = stripeWeights.trim()
        ? stripeWeights
            .split(/[\s,;]+/)
            .filter(Boolean)
            .map(Number)
        : undefined
      let next = generateStripes(current, {
        count: stripeCount,
        angle: stripeAngle,
        gap: stripeGap,
        colors,
        weights,
      })
      const newGroup = next.groups.at(-1)!
      if (oldGroup) {
        const generated = next.elements
          .filter((element) => element.groupId === newGroup.id)
          .map((element, index) => {
            const old = oldElements[index]
            return {
              ...element,
              groupId: oldGroup.id,
              ...(old
                ? {
                    id: old.id,
                    materialId: old.materialId,
                    name: old.name,
                    visible: old.visible,
                  }
                : {}),
            }
          })
        let index = 0
        const elements: PatternElement[] = []
        for (const element of value.elements) {
          if (element.groupId !== oldGroup.id) {
            elements.push(element)
            continue
          }
          if (generated[index]) elements.push(generated[index])
          index += 1
          // Keep the group beneath any later overlay, including newly added stripes.
          if (index === oldElements.length)
            elements.push(...generated.slice(index))
        }
        if (!oldElements.length) elements.push(...generated)
        next = {
          ...next,
          groups: next.groups.map((group) =>
            group.id === newGroup.id
              ? { ...group, id: oldGroup.id, name: oldGroup.name }
              : group,
          ),
          elements,
        }
      }
      if (commit(next)) {
        setSelectedId(
          next.elements.find(
            (element) => element.groupId === (oldGroup?.id ?? newGroup.id),
          )?.id ?? null,
        )
        setGeneratorGroupId(oldGroup?.id ?? newGroup.id)
        setAnnouncement(
          `${stripeCount} editable stripes ${oldGroup ? 'redistributed' : 'generated'}.`,
        )
      }
    })
  const align = (
    axis: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom',
  ) => {
    if (!selected) return
    const bounds = boundsOf(selected),
      frame = value.frame
    const x =
      axis === 'left'
        ? selected.x + frame.centerX - frame.width / 2 - bounds.left
        : axis === 'right'
          ? selected.x + frame.centerX + frame.width / 2 - bounds.right
          : axis === 'centerX'
            ? selected.x + frame.centerX - (bounds.left + bounds.right) / 2
            : selected.x
    const y =
      axis === 'bottom'
        ? selected.y + frame.centerY - frame.height / 2 - bounds.bottom
        : axis === 'top'
          ? selected.y + frame.centerY + frame.height / 2 - bounds.top
          : axis === 'centerY'
            ? selected.y + frame.centerY - (bounds.bottom + bounds.top) / 2
            : selected.y
    editElement({ ...selected, x, y })
  }
  const distributeGroup = (axis: 'x' | 'y') => {
    if (!selectedGroup) return
    const elements = value.elements
      .filter((element) => element.groupId === selectedGroup.id)
      .sort((a, b) => a[axis] - b[axis])
    if (elements.length < 3) return
    const min = elements[0][axis],
      max = elements.at(-1)![axis]
    const positions = new Map(
      elements.map((element, index) => [
        element.id,
        min + ((max - min) * index) / (elements.length - 1),
      ]),
    )
    commit({
      ...value,
      elements: value.elements.map((element) =>
        positions.has(element.id)
          ? { ...element, [axis]: positions.get(element.id)! }
          : element,
      ),
    })
  }
  const mergeMaterial = (id: string) => {
    const replacement = materials.some(
      (material) => material.id === mergeTargets[id] && material.id !== id,
    )
      ? mergeTargets[id]
      : 'base'
    commit({
      ...value,
      materials: value.materials.filter((material) => material.id !== id),
      elements: value.elements.map((element) =>
        element.materialId === id
          ? { ...element, materialId: replacement }
          : element,
      ),
    })
  }

  return (
    <div className="multicolor-editor" aria-label="Multicolor configurator">
      <div className="multicolor-intro">
        <strong>Make it your own</strong>
        <p>
          Build a flag or a free composition. Colors become separate printable
          regions through the panel.
        </p>
      </div>
      <details className="multicolor-details">
        <summary>
          Choose a preset <span>8 editable patterns</span>
        </summary>
        <div className="multicolor-details-body">
          <label className="multicolor-select">
            <span>Pattern preset</span>
            <select
              aria-label="Pattern preset"
              value={presetId}
              onChange={(event) => setPresetId(event.target.value)}
            >
              {MULTICOLOR_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <label className="multicolor-select">
            <span>Preset layout</span>
            <select
              aria-label="Preset layout"
              value={layout}
              onChange={(event) =>
                setLayout(event.target.value as typeof layout)
              }
            >
              <option value="panel">Adapt to artwork frame</option>
              <option value="proportional">Keep flag proportions</option>
            </select>
          </label>
          <p className="multicolor-hint">
            Replaces the artwork, palette, and background. Panel shape and knob
            settings stay as they are.
          </p>
          <button
            type="button"
            className="multicolor-primary-button"
            onClick={() => applyPreset()}
          >
            Apply editable preset
          </button>
        </div>
      </details>
      <details
        className="multicolor-details"
        open={generatorOpen}
        onToggle={(event) => setGeneratorOpen(event.currentTarget.open)}
      >
        <summary>
          Generate stripes <span>Any direction</span>
        </summary>
        <div className="multicolor-details-body">
          <label className="multicolor-select">
            <span>Generate into</span>
            <select
              aria-label="Generate into"
              value={generatorGroup?.id ?? ''}
              onChange={(event) => {
                const id = event.target.value || null
                setGeneratorGroupId(id)
                const group = value.groups.find((group) => group.id === id)
                if (group?.generator) {
                  setStripeCount(group.generator.count)
                  setStripeAngle(group.generator.angle)
                  setStripeGap(group.generator.gap)
                  setStripeWeights(group.generator.weights?.join(', ') ?? '')
                  setStripeColors(
                    value.elements
                      .filter((element) => element.groupId === id)
                      .map((element) => materialColor(element.materialId))
                      .join(', '),
                  )
                }
              }}
            >
              <option value="">New stripe group</option>
              {value.groups
                .filter((group) => group.generator)
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    Redistribute: {group.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="multicolor-field-grid">
            <NumberField
              label="Stripe count"
              value={stripeCount}
              onChange={setStripeCount}
              min={1}
              max={MULTICOLOR_LIMITS.elements}
              step={1}
              unit=""
            />
            <NumberField
              label="Stripe gap"
              value={stripeGap}
              onChange={setStripeGap}
              min={0}
            />
          </div>
          <div className="multicolor-direction-buttons">
            <button
              type="button"
              aria-pressed={stripeAngle === 0}
              onClick={() => setStripeAngle(0)}
            >
              Vertical
            </button>
            <button
              type="button"
              aria-pressed={stripeAngle === 270}
              onClick={() => setStripeAngle(270)}
            >
              Horizontal
            </button>
            <button
              type="button"
              aria-pressed={stripeAngle === 45}
              onClick={() => setStripeAngle(45)}
            >
              Diagonal
            </button>
          </div>
          <NumberField
            label="Stripe direction"
            value={stripeAngle}
            onChange={setStripeAngle}
            min={-360}
            max={360}
            unit="°"
          />
          <label className="multicolor-text-field">
            <span>
              Width weights <small>optional</small>
            </span>
            <input
              aria-label="Stripe width weights"
              value={stripeWeights}
              placeholder="Equal widths, or e.g. 1, 2, 1"
              onChange={(event) => setStripeWeights(event.target.value)}
            />
          </label>
          <label className="multicolor-text-field">
            <span>Color sequence</span>
            <textarea
              aria-label="Stripe color sequence"
              rows={2}
              value={stripeColors}
              onChange={(event) => setStripeColors(event.target.value)}
            />
          </label>
          <p className="multicolor-hint">
            Six-digit hex colors repeat in sequence. Gaps reveal the background.{' '}
            {generatorGroup
              ? 'Redistributing replaces this group’s manual placement and preserves existing shape materials.'
              : 'Generated stripes remain individually editable.'}
          </p>
          <button
            type="button"
            className="multicolor-primary-button"
            onClick={generate}
          >
            {generatorGroup
              ? 'Redistribute stripe group'
              : 'Generate editable stripes'}
          </button>
        </div>
      </details>

      <MulticolorCanvas
        value={value}
        panelColor={panelColor}
        geometry={geometry}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onChange={commit}
        onDuplicate={duplicate}
        onDelete={remove}
        onBeginTransaction={onBeginTransaction}
        onEndTransaction={onEndTransaction}
      />

      <div className="multicolor-section-heading">
        <strong>Shapes</strong>
        <span>
          {value.elements.length} / {MULTICOLOR_LIMITS.elements}
        </span>
      </div>
      <div
        className="multicolor-add-buttons"
        role="group"
        aria-label="Add pattern shape"
      >
        <button type="button" onClick={() => addShape('stripe')}>
          <RectangleHorizontal size={15} />
          Stripe
        </button>
        <button type="button" onClick={() => addShape('cross')}>
          <Plus size={15} />
          Cross
        </button>
        <button type="button" onClick={() => addShape('circle')}>
          <Circle size={15} />
          Circle
        </button>
        <button type="button" onClick={() => addShape('polygon')}>
          <Shapes size={15} />
          Polygon
        </button>
        <button
          type="button"
          onClick={() => chooseSvg()}
          disabled={importingSvg}
        >
          <FileUp size={15} />
          SVG
        </button>
        <button type="button" onClick={() => addShape('text')}>
          <Type size={15} />
          Text
        </button>
      </div>
      <p className="multicolor-hint multicolor-import-hint">
        SVGs use one material. Convert strokes and text to filled paths before
        importing.
      </p>
      <input
        ref={svgInput}
        type="file"
        accept=".svg,image/svg+xml"
        aria-label="Import SVG shape"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void readSvg(file)
        }}
      />
      {importingSvg && (
        <p className="multicolor-hint" role="status">
          Importing SVG…
        </p>
      )}
      {!value.elements.length ? (
        <p className="multicolor-empty">
          Start with a shape, a preset, or generated stripes.
        </p>
      ) : (
        <ol
          className="multicolor-layers"
          aria-label="Pattern layers, topmost first"
        >
          {[...value.elements].reverse().map((element) => {
            const index = value.elements.findIndex(
              (candidate) => candidate.id === element.id,
            )
            const bounds = boundsOf(element)
            const outside =
              bounds.right < value.frame.centerX - value.frame.width / 2 ||
              bounds.left > value.frame.centerX + value.frame.width / 2 ||
              bounds.top < value.frame.centerY - value.frame.height / 2 ||
              bounds.bottom > value.frame.centerY + value.frame.height / 2
            return (
              <li
                key={element.id}
                className={selectedId === element.id ? 'is-selected' : ''}
              >
                <button
                  type="button"
                  className="multicolor-layer-select"
                  aria-pressed={selectedId === element.id}
                  onClick={() => {
                    setSelectedId(element.id)
                    setAnnouncement(`${element.name} selected.`)
                  }}
                >
                  <i
                    style={{ background: materialColor(element.materialId) }}
                    aria-hidden="true"
                  />
                  <span>
                    {element.name}
                    <small>
                      {!element.visible
                        ? 'Hidden'
                        : outside
                          ? 'Outside artwork frame'
                          : element.kind}
                      {element.groupId ? ' · grouped' : ''}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`${element.visible ? 'Hide' : 'Show'} ${element.name}`}
                  onClick={() =>
                    editElement({ ...element, visible: !element.visible })
                  }
                >
                  {element.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  type="button"
                  aria-label={`Move ${element.name} forward`}
                  disabled={index === value.elements.length - 1}
                  onClick={() => reorder(element.id, 1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${element.name} backward`}
                  disabled={index === 0}
                  onClick={() => reorder(element.id, -1)}
                >
                  <ArrowDown size={14} />
                </button>
              </li>
            )
          })}
        </ol>
      )}
      {value.elements.length > 1 && (
        <p className="multicolor-hint">
          Top shapes cover lower shapes. A background-colored shape covers too;
          a ring leaves its center open.
        </p>
      )}

      {selected && (
        <section
          className="multicolor-selected"
          aria-label="Selected shape controls"
        >
          <div className="multicolor-section-heading">
            <strong>Edit {selected.kind}</strong>
            <div className="multicolor-icon-actions">
              <button
                type="button"
                aria-label={`Duplicate ${selected.name}`}
                onClick={duplicate}
              >
                <Copy size={15} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${selected.name}`}
                onClick={remove}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
          <TextField
            label="Shape name"
            value={selected.name}
            onChange={(name) => editElement({ ...selected, name })}
          />
          <label className="multicolor-select">
            <span>Shape material</span>
            <select
              aria-label="Shape material"
              value={selected.materialId}
              onChange={(event) =>
                editElement({ ...selected, materialId: event.target.value })
              }
            >
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} · {material.color}
                </option>
              ))}
            </select>
          </label>
          <div className="multicolor-material-edit">
            <ColorField
              label={
                materials.find(
                  (material) => material.id === selected.materialId,
                )?.name ?? 'Shape'
              }
              value={materialColor(selected.materialId)}
              onChange={(color) =>
                selected.materialId === 'base'
                  ? onPanelColorChange(color)
                  : commit({
                      ...value,
                      materials: value.materials.map((material) =>
                        material.id === selected.materialId
                          ? { ...material, color }
                          : material,
                      ),
                    })
              }
            />
            <button
              type="button"
              onClick={() => {
                const id = createPatternId('material')
                commit({
                  ...value,
                  materials: [
                    ...value.materials,
                    {
                      id,
                      name: `${selected.name.slice(0, 65)} color`,
                      color: materialColor(selected.materialId),
                    },
                  ],
                  elements: value.elements.map((element) =>
                    element.id === selected.id
                      ? { ...element, materialId: id }
                      : element,
                  ),
                })
              }}
            >
              Make unique
            </button>
          </div>
          <p className="multicolor-hint">
            Editing this color updates all shapes using this material.
          </p>
          <div className="multicolor-field-grid">
            <NumberField
              label="Position X"
              value={selected.x}
              onChange={(x) => editElement({ ...selected, x })}
            />
            <NumberField
              label="Position Y"
              value={selected.y}
              onChange={(y) => editElement({ ...selected, y })}
            />
          </div>
          <NumberField
            label="Rotation"
            value={selected.rotation}
            onChange={(rotation) => editElement({ ...selected, rotation })}
            min={-360}
            max={360}
            unit="°"
          />
          {selected.kind === 'svg' && (
            <>
              <div className="multicolor-svg-source">
                <span title={selected.sourceName}>{selected.sourceName}</span>
                <button
                  type="button"
                  onClick={() => chooseSvg(selected.id)}
                  disabled={importingSvg}
                >
                  Replace SVG
                </button>
              </div>
              <div className="multicolor-field-grid">
                <NumberField
                  label="SVG width"
                  value={selected.width}
                  min={0.01}
                  onChange={(width) =>
                    editElement({
                      ...selected,
                      width,
                      height: (selected.height * width) / selected.width,
                    })
                  }
                />
                <NumberField
                  label="SVG height"
                  value={selected.height}
                  min={0.01}
                  onChange={(height) =>
                    editElement({
                      ...selected,
                      height,
                      width: (selected.width * height) / selected.height,
                    })
                  }
                />
              </div>
              <p className="multicolor-hint">
                Resizing keeps the SVG proportions. All imported shapes use this
                layer’s material.
              </p>
            </>
          )}
          {selected.kind === 'text' && (
            <>
              <TextField
                label="Text content"
                value={selected.text}
                maxLength={MULTICOLOR_LIMITS.textLength}
                onChange={(text) => editElement({ ...selected, text })}
              />
              <label className="multicolor-select">
                <span>Text font</span>
                <select
                  aria-label="Text font"
                  value={selected.fontId}
                  onChange={(event) =>
                    editElement({
                      ...selected,
                      fontId: event.target.value as PatternFontId,
                    })
                  }
                >
                  {PATTERN_FONTS.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.name}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField
                label="Font size"
                value={selected.fontSize}
                min={0.1}
                onChange={(fontSize) => editElement({ ...selected, fontSize })}
              />
            </>
          )}
          {selected.kind === 'stripe' && (
            <>
              <div className="multicolor-field-grid">
                <NumberField
                  label="Stripe width"
                  value={selected.width}
                  min={0.01}
                  onChange={(width) => editElement({ ...selected, width })}
                />
                <NumberField
                  label="Stripe length"
                  value={selected.height}
                  min={0.01}
                  onChange={(height) => editElement({ ...selected, height })}
                />
              </div>
              <button
                type="button"
                className="multicolor-wide-button"
                onClick={() => {
                  const angle = (selected.rotation * Math.PI) / 180
                  editElement({
                    ...selected,
                    height:
                      Math.abs(Math.sin(angle)) * value.frame.width +
                      Math.abs(Math.cos(angle)) * value.frame.height,
                  })
                }}
              >
                Span artwork frame
              </button>
            </>
          )}
          {selected.kind === 'circle' && (
            <div className="multicolor-field-grid">
              <NumberField
                label="Outer radius"
                value={selected.radius}
                min={Math.max(0.01, selected.innerRadius + 0.01)}
                onChange={(radius) => editElement({ ...selected, radius })}
              />
              <NumberField
                label="Inner radius"
                value={selected.innerRadius}
                min={0}
                max={Math.max(0, selected.radius - 0.01)}
                onChange={(innerRadius) =>
                  editElement({ ...selected, innerRadius })
                }
              />
              <p className="multicolor-hint full-width">
                Set the inner radius to zero for a filled circle.
              </p>
            </div>
          )}
          {selected.kind === 'cross' && (
            <div className="multicolor-field-grid">
              <NumberField
                label="Left arm"
                value={selected.left}
                min={selected.verticalThickness / 2}
                onChange={(left) => editElement({ ...selected, left })}
              />
              <NumberField
                label="Right arm"
                value={selected.right}
                min={selected.verticalThickness / 2}
                onChange={(right) => editElement({ ...selected, right })}
              />
              <NumberField
                label="Top arm"
                value={selected.top}
                min={selected.horizontalThickness / 2}
                onChange={(top) => editElement({ ...selected, top })}
              />
              <NumberField
                label="Bottom arm"
                value={selected.bottom}
                min={selected.horizontalThickness / 2}
                onChange={(bottom) => editElement({ ...selected, bottom })}
              />
              <NumberField
                label="Horizontal thickness"
                value={selected.horizontalThickness}
                min={0.01}
                max={Math.min(selected.top, selected.bottom) * 2}
                onChange={(horizontalThickness) =>
                  editElement({ ...selected, horizontalThickness })
                }
              />
              <NumberField
                label="Vertical thickness"
                value={selected.verticalThickness}
                min={0.01}
                max={Math.min(selected.left, selected.right) * 2}
                onChange={(verticalThickness) =>
                  editElement({ ...selected, verticalThickness })
                }
              />
            </div>
          )}
          {selected.kind === 'polygon' && (
            <details className="multicolor-details" open>
              <summary>
                Polygon vertices <span>{selected.points.length} points</span>
              </summary>
              <div className="multicolor-details-body">
                <p className="multicolor-hint">
                  Local coordinates, before rotation. Drag the round handles on
                  the canvas or edit below. Edges must not cross.
                </p>
                {selected.points.map(([x, y], index) => (
                  <div key={index} className="multicolor-vertex-row">
                    <span>{index + 1}</span>
                    <NumberField
                      label={`Vertex ${index + 1} X`}
                      value={x}
                      onChange={(next) =>
                        editElement({
                          ...selected,
                          points: selected.points.map((point, vertex) =>
                            vertex === index ? [next, point[1]] : point,
                          ),
                        })
                      }
                    />
                    <NumberField
                      label={`Vertex ${index + 1} Y`}
                      value={y}
                      onChange={(next) =>
                        editElement({
                          ...selected,
                          points: selected.points.map((point, vertex) =>
                            vertex === index ? [point[0], next] : point,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      disabled={selected.points.length <= 3}
                      aria-label={`Remove vertex ${index + 1}`}
                      onClick={() =>
                        editElement({
                          ...selected,
                          points: selected.points.filter(
                            (_, vertex) => vertex !== index,
                          ),
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="multicolor-wide-button"
                  disabled={
                    selected.points.length >= MULTICOLOR_LIMITS.polygonVertices
                  }
                  onClick={() => {
                    const first = selected.points[0],
                      last = selected.points.at(-1)!
                    editElement({
                      ...selected,
                      points: [
                        ...selected.points,
                        [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2],
                      ],
                    })
                  }}
                >
                  Add vertex on closing edge
                </button>
              </div>
            </details>
          )}
          <details className="multicolor-details">
            <summary>Align to artwork frame</summary>
            <div className="multicolor-align-buttons">
              {(
                [
                  'left',
                  'centerX',
                  'right',
                  'top',
                  'centerY',
                  'bottom',
                ] as const
              ).map((axis) => (
                <button type="button" key={axis} onClick={() => align(axis)}>
                  {
                    {
                      left: 'Left',
                      centerX: 'Center X',
                      right: 'Right',
                      top: 'Top',
                      centerY: 'Center Y',
                      bottom: 'Bottom',
                    }[axis]
                  }
                </button>
              ))}
            </div>
          </details>
          {selectedGroup && (
            <details className="multicolor-details">
              <summary>Group: {selectedGroup.name}</summary>
              <div className="multicolor-details-body">
                <TextField
                  label="Group name"
                  value={selectedGroup.name}
                  onChange={(name) =>
                    commit({
                      ...value,
                      groups: value.groups.map((group) =>
                        group.id === selectedGroup.id
                          ? { ...group, name }
                          : group,
                      ),
                    })
                  }
                />
                <div className="multicolor-direction-buttons">
                  <button type="button" onClick={() => distributeGroup('x')}>
                    Space evenly X
                  </button>
                  <button type="button" onClick={() => distributeGroup('y')}>
                    Space evenly Y
                  </button>
                </div>
                {selectedGroup.generator && (
                  <button
                    type="button"
                    className="multicolor-wide-button"
                    onClick={() => {
                      const recipe = selectedGroup.generator!
                      setGeneratorGroupId(selectedGroup.id)
                      setStripeCount(recipe.count)
                      setStripeAngle(recipe.angle)
                      setStripeGap(recipe.gap)
                      setStripeWeights(recipe.weights?.join(', ') ?? '')
                      setStripeColors(
                        value.elements
                          .filter(
                            (element) => element.groupId === selectedGroup.id,
                          )
                          .map((element) => materialColor(element.materialId))
                          .join(', '),
                      )
                      setGeneratorOpen(true)
                    }}
                  >
                    Edit stripe generator
                  </button>
                )}
                <button
                  type="button"
                  className="multicolor-wide-button"
                  onClick={() =>
                    commit({
                      ...value,
                      groups: value.groups.filter(
                        (group) => group.id !== selectedGroup.id,
                      ),
                      elements: value.elements.map((element) => {
                        if (element.groupId !== selectedGroup.id) return element
                        const copy = { ...element }
                        delete copy.groupId
                        return copy
                      }),
                    })
                  }
                >
                  Ungroup shapes
                </button>
              </div>
            </details>
          )}
        </section>
      )}

      <details className="multicolor-details">
        <summary>
          Material palette <span>{value.materials.length + 1} colors</span>
        </summary>
        <div className="multicolor-details-body">
          <div className="multicolor-palette-base">
            <strong>Background</strong>
            <ColorField
              label="Background material"
              value={panelColor}
              onChange={onPanelColorChange}
            />
          </div>
          {value.materials.map((material) => {
            const references = value.elements.filter(
              (element) => element.materialId === material.id,
            ).length
            return (
              <div key={material.id} className="multicolor-palette-row">
                <TextField
                  label="Material name"
                  value={material.name}
                  onChange={(name) =>
                    commit({
                      ...value,
                      materials: value.materials.map((entry) =>
                        entry.id === material.id ? { ...entry, name } : entry,
                      ),
                    })
                  }
                />
                <ColorField
                  label={material.name}
                  value={material.color}
                  onChange={(color) =>
                    commit({
                      ...value,
                      materials: value.materials.map((entry) =>
                        entry.id === material.id ? { ...entry, color } : entry,
                      ),
                    })
                  }
                />
                <small className="multicolor-hint">
                  {references
                    ? `${references} ${references === 1 ? 'shape uses' : 'shapes use'} this material`
                    : 'Unused material'}
                </small>
                <div className="multicolor-merge-row">
                  <select
                    aria-label={`Replacement for ${material.name}`}
                    value={mergeTargets[material.id] ?? 'base'}
                    onChange={(event) =>
                      setMergeTargets({
                        ...mergeTargets,
                        [material.id]: event.target.value,
                      })
                    }
                  >
                    {materials
                      .filter((entry) => entry.id !== material.id)
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => mergeMaterial(material.id)}
                  >
                    {references ? 'Merge into' : 'Remove'}
                  </button>
                </div>
              </div>
            )
          })}
          <button
            type="button"
            className="multicolor-wide-button"
            disabled={value.materials.length >= MULTICOLOR_LIMITS.materials}
            onClick={() =>
              commit({
                ...value,
                materials: [
                  ...value.materials,
                  {
                    id: createPatternId('material'),
                    name: `Color ${value.materials.length + 1}`,
                    color: '#ffffff',
                  },
                ],
              })
            }
          >
            <Plus size={14} />
            Add material
          </button>
          <p className="multicolor-hint">
            Matching colors stay separate materials until you merge them.
            Merging reassigns every shape using the removed material.
          </p>
        </div>
      </details>
      <details className="multicolor-details">
        <summary>
          Artwork frame <span>Physical size</span>
        </summary>
        <div className="multicolor-details-body">
          <div className="multicolor-field-grid">
            <NumberField
              label="Frame center X"
              value={value.frame.centerX}
              onChange={(centerX) =>
                commit({ ...value, frame: { ...value.frame, centerX } })
              }
            />
            <NumberField
              label="Frame center Y"
              value={value.frame.centerY}
              onChange={(centerY) =>
                commit({ ...value, frame: { ...value.frame, centerY } })
              }
            />
            <NumberField
              label="Frame width"
              value={value.frame.width}
              min={0.01}
              onChange={(width) =>
                commit({ ...value, frame: { ...value.frame, width } })
              }
            />
            <NumberField
              label="Frame height"
              value={value.frame.height}
              min={0.01}
              onChange={(height) =>
                commit({ ...value, frame: { ...value.frame, height } })
              }
            />
          </div>
          <p className="multicolor-hint">
            Changing the frame crops the artwork without moving its shapes.
            Fitting scales the entire composition uniformly, keeping circles
            round.
          </p>
          <button
            type="button"
            className="multicolor-wide-button"
            onClick={() =>
              attempt(() => {
                commit(fitMulticolorArtwork(value, panelFrame(geometry, model)))
              })
            }
          >
            Fit artwork to current panel
          </button>
          <button
            type="button"
            className="multicolor-wide-button"
            onClick={() => applyPreset(true)}
          >
            Reapply chosen preset to panel
          </button>
        </div>
      </details>
      <div className="multicolor-print-note">
        <strong>
          {value.elements.length} shapes · {assignedIds.size} assigned materials
        </strong>
        <p>
          Only regions that intersect the panel are printed. Covered shapes and
          shapes in openings can contribute no material. Export shows the
          resolved material count. Assign matching filaments in your slicer.
        </p>
      </div>
      {error && (
        <div className="multicolor-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss artwork error"
            onClick={() => setError(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <span className="multicolor-sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}
