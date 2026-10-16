import { useId, useState } from 'react'
import { useNumericDraft } from '@/lib/use-numeric-draft'
import { Check, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { KnobIcon } from '@/components/KnobIcon'
import { Slider } from '@/components/ui/slider'
import {
  KNOB_STYLES,
  getDefaultKnobSettings,
  getKnobLimits,
  normalizeKnobSettings,
  type KnobNumericKey,
  type KnobSettings,
} from '@/lib/knob-settings'
import { validateKnobText } from '@/lib/knob-text'
import {
  PATTERN_FONTS,
  PATTERN_FONT_WEIGHT_LABELS,
  getPatternFont,
  nearestPatternFontWeight,
  type PatternFontId,
  type PatternFontWeight,
} from '@/lib/multicolor-font-catalog'

const FONT_GROUPS = Array.from(
  new Set(PATTERN_FONTS.map((font) => font.category)),
).map((category) => ({
  category,
  fonts: PATTERN_FONTS.filter((font) => font.category === category).sort(
    (left, right) => left.name.localeCompare(right.name),
  ),
}))

type KnobTextSettings = Pick<KnobSettings, 'text' | 'fontId' | 'fontWeight'>

function textSettings(value: KnobSettings): KnobTextSettings {
  return {
    text: value.text,
    fontId: value.fontId,
    fontWeight: value.fontWeight,
  }
}

function textError(value: KnobTextSettings) {
  try {
    validateKnobText(value.text, value.fontId, value.fontWeight)
    return null
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'Choose one or two visible characters.'
  }
}

interface Props {
  value: KnobSettings
  onChange: (value: KnobSettings) => void
  color: string
  onColorChange: (value: string) => void
}

function KnobParameter({
  label,
  value,
  min,
  max,
  step = 0.5,
  unit = 'mm',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: 'mm' | ''
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useNumericDraft(value)
  const spokenUnit = unit === 'mm' ? 'millimeters' : ''
  const commit = () => {
    // Showing a rounded measurement must not alter an untouched source mesh.
    if (draft.trim() === String(Number(value.toFixed(2)))) return
    const numeric = Number(draft)
    const clamped =
      draft.trim() && Number.isFinite(numeric)
        ? Math.min(max, Math.max(min, numeric))
        : value
    const next = unit ? clamped : Math.round(clamped)
    setDraft(String(Number(next.toFixed(2))))
    if (next !== value) onChange(next)
  }

  return (
    <div className="knob-parameter">
      <div className="control-label">
        <span>{label}</span>
        <label className="dimension-input">
          <input
            aria-label={spokenUnit ? `${label} in ${spokenUnit}` : label}
            type="number"
            inputMode={unit ? 'decimal' : 'numeric'}
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              const next = event.target.valueAsNumber
              if (
                Number.isFinite(next) &&
                next >= min &&
                next <= max &&
                next !== value
              )
                onChange(next)
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
          {unit && <span aria-hidden="true">{unit}</span>}
        </label>
      </div>
      <Slider
        aria-label={label}
        aria-valuetext={`${Number(value.toFixed(2))}${spokenUnit ? ` ${spokenUnit}` : ''}`}
        value={[value]}
        min={min}
        max={Math.max(min + step, max)}
        step={step}
        disabled={max <= min}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  )
}

function RibPatternIcon({
  pattern,
}: {
  pattern: 'straight' | 'spiral' | 'chevron'
}) {
  return (
    <svg
      viewBox="0 0 36 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {[-8, 0, 8].map((offset) => (
        <path
          key={offset}
          d={
            pattern === 'straight'
              ? `M${18 + offset} 5v22`
              : pattern === 'spiral'
                ? `M${23 + offset} 5C${23 + offset} 14 ${13 + offset} 18 ${13 + offset} 27`
                : `M${15 + offset} 5l7 11-7 11`
          }
        />
      ))}
    </svg>
  )
}

export function KnobEditor({ value, onChange, color, onColorChange }: Props) {
  const textHintId = useId()
  const textErrorId = useId()
  const fontWeightHintId = useId()
  const [previousText, setPreviousText] = useState(() => textSettings(value))
  const [textDraft, setTextDraft] = useState(() => textSettings(value))
  if (
    previousText.text !== value.text ||
    previousText.fontId !== value.fontId ||
    previousText.fontWeight !== value.fontWeight
  ) {
    setPreviousText(textSettings(value))
    setTextDraft(textSettings(value))
  }
  const limits = getKnobLimits(value)
  const defaults = getDefaultKnobSettings(value.style)
  const selected = KNOB_STYLES.find((style) => style.id === value.style)!
  const set = (patch: Partial<KnobSettings>) =>
    onChange(normalizeKnobSettings({ ...value, ...patch }))
  const editText = (patch: Partial<KnobTextSettings>) => {
    const next = { ...textDraft, ...patch }
    setTextDraft(next)
    if (!textError(next)) set(next)
  }
  const selectedFont = getPatternFont(textDraft.fontId)
  const invalidText = value.style === 'text' ? textError(textDraft) : null
  const hasCustomGrip =
    Boolean(invalidText) ||
    (
      [
        'height',
        'taper',
        'fluteCount',
        'fluteDepth',
        'flutePath',
        'facets',
        'gripWidth',
        'gripDepth',
        'gripThickness',
        'text',
        'fontId',
        'fontWeight',
      ] as const
    ).some((key) => value[key] !== defaults[key])
  const parameter = (
    key: KnobNumericKey,
    label: string,
    options: { step?: number; unit?: 'mm' | '' } = {},
  ) => (
    <KnobParameter
      label={label}
      value={value[key]}
      min={limits[key].min}
      max={limits[key].max}
      {...options}
      onChange={(next) => set({ [key]: next })}
    />
  )

  return (
    <div className="knob-editor">
      <section className="control-section knob-shapes">
        <h3>
          <SlidersHorizontal size={16} aria-hidden="true" /> Volume knob
        </h3>
        <p className="knob-intro">
          Choose an original grip or try a new shape. Your knob is included in
          the export.
        </p>
        <div className="knob-options" role="group" aria-label="Knob shape">
          {KNOB_STYLES.map((style) => (
            <button
              type="button"
              key={style.id}
              aria-label={`${style.label} knob`}
              aria-pressed={value.style === style.id}
              onClick={() =>
                set({
                  style: style.id,
                  height:
                    value.height -
                    defaults.height +
                    getDefaultKnobSettings(style.id).height,
                })
              }
              title={style.description}
            >
              <KnobIcon style={style.id} />
              <span>{style.label}</span>
              <small>
                {style.collection === 'original' ? 'Original' : 'New shape'}
              </small>
              {value.style === style.id && (
                <Check size={13} className="knob-check" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        <p className="style-description">{selected.description}</p>
      </section>
      <section className="control-section knob-color">
        <h3>
          <span aria-hidden="true">01</span> Color
        </h3>
        <ColorPicker
          label="Volume knob"
          value={color}
          onChange={onColorChange}
        />
      </section>
      <section className="control-section knob-dimensions">
        <div className="knob-section-heading">
          <h3>
            <span aria-hidden="true">02</span> Grip
          </h3>
          <button
            className="text-button"
            type="button"
            disabled={!hasCustomGrip}
            onClick={() => {
              setTextDraft(textSettings(defaults))
              onChange(defaults)
            }}
          >
            <RotateCcw size={13} aria-hidden="true" /> Reset grip
          </button>
        </div>
        <div className="knob-fit">
          <span>
            <Check size={13} aria-hidden="true" /> Original fit
          </span>
          <span>Fixed base and socket</span>
        </div>
        {value.style === 'text' && (
          <div className="knob-text-controls">
            <label className="knob-text-field">
              <span>Knob text</span>
              <input
                type="text"
                value={textDraft.text}
                aria-invalid={Boolean(invalidText) || undefined}
                aria-describedby={`${textHintId}${invalidText ? ` ${textErrorId}` : ''}`}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => editText({ text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setTextDraft(textSettings(value))
                  }
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </label>
            <p id={textHintId} className="knob-parameter-note">
              Enter one or two characters. Text is centered and scaled
              automatically to fit the knob.
            </p>
            <label className="knob-text-field">
              <span>Text font</span>
              <select
                value={textDraft.fontId}
                onChange={(event) => {
                  const fontId = event.target.value as PatternFontId
                  editText({
                    fontId,
                    fontWeight: nearestPatternFontWeight(
                      fontId,
                      textDraft.fontWeight,
                    ),
                  })
                }}
              >
                {FONT_GROUPS.map(({ category, fonts }) => (
                  <optgroup key={category} label={category}>
                    {fonts.map((font) => (
                      <option key={font.id} value={font.id}>
                        {font.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="knob-text-field">
              <span>Font weight</span>
              <select
                value={textDraft.fontWeight}
                disabled={selectedFont.weights.length === 1}
                aria-describedby={
                  selectedFont.weights.length === 1
                    ? fontWeightHintId
                    : undefined
                }
                onChange={(event) =>
                  editText({
                    fontWeight: Number(event.target.value) as PatternFontWeight,
                  })
                }
              >
                {selectedFont.weights.map((weight) => (
                  <option key={weight} value={weight}>
                    {PATTERN_FONT_WEIGHT_LABELS[weight]} ({weight})
                  </option>
                ))}
              </select>
            </label>
            {selectedFont.weights.length === 1 && (
              <p id={fontWeightHintId} className="knob-parameter-note">
                {selectedFont.name} is available in{' '}
                {PATTERN_FONT_WEIGHT_LABELS[
                  selectedFont.weights[0]
                ].toLowerCase()}{' '}
                weight only.
              </p>
            )}
            {invalidText && (
              <p id={textErrorId} className="knob-text-error" role="alert">
                {invalidText} Preview and export use the last valid text.
              </p>
            )}
          </div>
        )}
        {parameter('height', 'Knob height')}
        {parameter('taper', 'Grip taper', { step: 0.1 })}
        <p className="knob-parameter-note">
          Narrow the top of the grip while the base stays the same.
        </p>
        {value.style === 'fluted' && (
          <>
            <div className="knob-pattern-heading">Rib pattern</div>
            <div
              className="knob-pattern-options"
              role="group"
              aria-label="Rib pattern"
            >
              {(
                [
                  { id: 'straight', label: 'Straight' },
                  { id: 'spiral', label: 'Spiral' },
                  { id: 'chevron', label: 'Chevron' },
                ] as const
              ).map((pattern) => (
                <button
                  type="button"
                  key={pattern.id}
                  aria-pressed={value.flutePath === pattern.id}
                  onClick={() => set({ flutePath: pattern.id })}
                >
                  <RibPatternIcon pattern={pattern.id} />
                  {pattern.label}
                </button>
              ))}
            </div>
            <p className="knob-parameter-note">
              {value.flutePath === 'straight'
                ? 'Vertical ribs for an even grip.'
                : value.flutePath === 'spiral'
                  ? 'Ribs sweep around the grip from bottom to top.'
                  : 'Ribs change direction halfway up the grip.'}
            </p>
            {parameter('fluteCount', 'Flute count', { step: 1, unit: '' })}
            {parameter('fluteDepth', 'Flute depth', { step: 0.1 })}
          </>
        )}
        {value.style === 'hex' &&
          parameter('facets', 'Facet count', { step: 1, unit: '' })}
        {(value.style === 'triangle' ||
          value.style === 'arrow' ||
          value.style === 'v') && (
          <>
            {parameter('gripWidth', 'Grip width')}
            {parameter('gripDepth', 'Grip depth')}
            {value.style !== 'triangle' &&
              parameter(
                'gripThickness',
                value.style === 'arrow' ? 'Shaft width' : 'Stroke width',
              )}
          </>
        )}
      </section>
    </div>
  )
}
