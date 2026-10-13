import { useEffect, useId, useMemo, useState } from 'react'
import { ArrowRight, Check, Sparkles } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import {
  getGrilleLimits,
  getGrillePattern,
  normalizeGrilleSettings,
  type GrilleSettings,
} from '@/lib/grille-settings'
import type { SpeakerModel } from '@/lib/panels'

interface Props {
  model: SpeakerModel
  value: GrilleSettings
  onChange: (value: GrilleSettings) => void
}

function GrilleParameter({
  label,
  value,
  min,
  max,
  step = 0.5,
  unit = 'mm',
  description,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: 'mm' | '°'
  description?: string
  onChange: (value: number) => void
}) {
  const descriptionId = useId()
  const [draft, setDraft] = useState(String(Number(value.toFixed(2))))
  useEffect(() => setDraft(String(Number(value.toFixed(2)))), [value])
  const commit = () => {
    const numeric = Number(draft)
    const next =
      draft.trim() && Number.isFinite(numeric)
        ? Math.min(max, Math.max(min, numeric))
        : value
    setDraft(String(Number(next.toFixed(2))))
    if (next !== value) onChange(next)
  }

  return (
    <div className="grille-parameter">
      <div className="control-label">
        <span>{label}</span>
        <label className="grille-dimension-input">
          <input
            aria-label={`${label} in ${unit === 'mm' ? 'millimeters' : 'degrees'}`}
            aria-describedby={description ? descriptionId : undefined}
            type="number"
            inputMode="decimal"
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
          <span aria-hidden="true">{unit}</span>
        </label>
      </div>
      <Slider
        aria-label={label}
        aria-describedby={description ? descriptionId : undefined}
        value={[value]}
        min={min}
        max={Math.max(min + step, max)}
        step={step}
        disabled={max <= min}
        onValueChange={([next]) => onChange(next)}
      />
      {description && <p id={descriptionId}>{description}</p>}
    </div>
  )
}

function PatternMark({
  pattern,
  staggered = false,
}: {
  pattern: GrilleSettings['pattern']
  staggered?: boolean
}) {
  return (
    <svg viewBox="0 0 48 42" fill="none" aria-hidden="true">
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2].map((column) => {
          const x = 12 + column * 12 + (staggered && row % 2 ? 4 : 0)
          const y = 9 + row * 12
          return pattern === 'round' ? (
            <circle key={`${row}:${column}`} cx={x} cy={y} r="3.1" />
          ) : pattern === 'hex' ? (
            <path
              key={`${row}:${column}`}
              d={`M${x} ${y - 3.7}l3.2 1.85v3.7L${x} ${y + 3.7}l-3.2-1.85v-3.7Z`}
            />
          ) : (
            <rect
              key={`${row}:${column}`}
              x={x - 4.2}
              y={y - 1.7}
              width="8.4"
              height="3.4"
              rx="1.7"
            />
          )
        }),
      )}
    </svg>
  )
}

function GrilleDiagram({
  model,
  value,
}: {
  model: SpeakerModel
  value: GrilleSettings
}) {
  const clipId = useId()
  const pattern = useMemo(() => getGrillePattern(model, value), [model, value])
  const opening = pattern.openings[0]
  const left = opening.x - 42
  const top = -opening.y - 42
  const visibleHoles = pattern.holes.filter(
    (hole) =>
      Math.abs(hole.x - opening.x) < 56 && Math.abs(hole.y - opening.y) < 56,
  )
  return (
    <div className="grille-diagram" aria-hidden="true">
      <svg viewBox={`${left} ${top} 84 84`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={top} width="84" height="84" rx="2" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect x={left} y={top} width="84" height="84" fill="#f5e3d8" />
          <circle
            cx={opening.x}
            cy={-opening.y}
            r={opening.radius}
            fill="#f7d9cb"
            stroke="#daab90"
            strokeWidth=".35"
          />
          {visibleHoles.map((hole, index) => (
            <polygon
              key={index}
              points={hole.points.map(([x, y]) => `${x},${-y}`).join(' ')}
              fill={hole.kind === 'through' ? '#f6f7f2' : '#eac0a9'}
              stroke={hole.kind === 'through' ? '#d58a61' : '#dcb091'}
              strokeWidth=".3"
            />
          ))}
        </g>
      </svg>
      <div className="grille-diagram-notes">
        <span>PATTERN DETAIL</span>
        <strong>
          {value.pattern === 'round'
            ? 'Round'
            : value.pattern === 'hex'
              ? 'Hexagon'
              : 'Slot'}
        </strong>
        <p>
          {value.size} mm {value.pattern === 'slot' ? 'wide' : 'openings'}
          <br />
          {value.spacing} mm between
        </p>
        <span className="grille-diagram-key">
          <i /> Through openings
        </span>
        {value.extendPattern && (
          <span className="grille-diagram-key recess">
            <i /> Surface recesses
          </span>
        )}
      </div>
    </div>
  )
}

export function GrilleEditor({ model, value, onChange }: Props) {
  const limits = getGrilleLimits(value)
  const set = (patch: Partial<GrilleSettings>) =>
    onChange(normalizeGrilleSettings({ ...value, ...patch }))
  const parameter = (
    key:
      | 'size'
      | 'spacing'
      | 'slotLength'
      | 'rotation'
      | 'thickness'
      | 'recessDepth',
    label: string,
    options: { step?: number; unit?: 'mm' | '°'; description?: string } = {},
  ) => (
    <GrilleParameter
      label={label}
      value={value[key]}
      min={limits[key].min}
      max={limits[key].max}
      {...options}
      onChange={(next) => set({ [key]: next })}
    />
  )

  return (
    <div className="grille-editor">
      <section className="control-section grille-intro">
        <div className="grille-heading">
          <h3>
            <Sparkles size={14} /> Find your rhythm
          </h3>
          <span className="new-tag">GENERATIVE</span>
        </div>
        <p>Choose the openings. Make the pattern your own.</p>
        <div
          className="grille-mode"
          role="group"
          aria-label="Grille generation mode"
        >
          <button
            type="button"
            aria-pressed={value.mode === 'original'}
            onClick={() => set({ mode: 'original' })}
          >
            Original grille
          </button>
          <button
            type="button"
            aria-pressed={value.mode === 'custom'}
            onClick={() => set({ mode: 'custom' })}
          >
            Custom grille <Sparkles size={12} />
          </button>
        </div>
      </section>
      {value.mode === 'original' ? (
        <div className="grille-original">
          <div className="grille-original-icon">
            <PatternMark pattern="round" staggered />
          </div>
          <h4>A familiar sound. A new look.</h4>
          <p>
            Generate your own grille with round holes, hexagons, or slots. Set
            the size, spacing, and direction.
          </p>
          <button type="button" onClick={() => set({ mode: 'custom' })}>
            Design your grille <ArrowRight size={14} />
          </button>
        </div>
      ) : (
        <>
          <GrilleDiagram model={model} value={value} />
          <section className="control-section">
            <h3>
              <span>01</span> Choose the opening
            </h3>
            <div
              className="grille-pattern-options"
              role="group"
              aria-label="Grille opening shape"
            >
              {(
                [
                  { id: 'round', label: 'Round' },
                  { id: 'hex', label: 'Hexagon' },
                  { id: 'slot', label: 'Slot' },
                ] as const
              ).map((pattern) => (
                <button
                  type="button"
                  key={pattern.id}
                  aria-pressed={value.pattern === pattern.id}
                  onClick={() => set({ pattern: pattern.id })}
                >
                  <PatternMark pattern={pattern.id} />
                  <span>{pattern.label}</span>
                </button>
              ))}
            </div>
            <div className="grille-layout-label">Arrangement</div>
            <div
              className="grille-layout-options"
              role="group"
              aria-label="Grille arrangement"
            >
              <button
                type="button"
                aria-pressed={value.layout === 'grid'}
                onClick={() => set({ layout: 'grid' })}
              >
                <PatternMark pattern="round" /> Aligned
              </button>
              <button
                type="button"
                aria-pressed={value.layout === 'staggered'}
                onClick={() => set({ layout: 'staggered' })}
              >
                <PatternMark pattern="round" staggered /> Staggered
              </button>
            </div>
          </section>
          <section className="control-section">
            <h3>
              <span>02</span> Size and spacing
            </h3>
            {parameter(
              'size',
              value.pattern === 'round'
                ? 'Hole diameter'
                : value.pattern === 'hex'
                  ? 'Hexagon diameter'
                  : 'Slot width',
              {
                step: 0.1,
                description:
                  value.pattern === 'hex'
                    ? 'Measured across opposite corners.'
                    : undefined,
              },
            )}
            {value.pattern === 'slot' && parameter('slotLength', 'Slot length')}
            {parameter('spacing', 'Space between openings', {
              step: 0.1,
              description: 'The width of the solid material between openings.',
            })}
            {parameter('rotation', 'Pattern rotation', { step: 5, unit: '°' })}
            <details className="grille-details">
              <summary>
                Grille thickness <span aria-hidden="true">+</span>
              </summary>
              <div>
                {parameter('thickness', 'Grille thickness', { step: 0.1 })}
              </div>
            </details>
          </section>
          <section className="control-section grille-extension">
            <h3>
              <span>03</span> Beyond the openings
            </h3>
            <label className="grille-extension-toggle">
              <input
                type="checkbox"
                checked={value.extendPattern}
                onChange={(event) =>
                  set({ extendPattern: event.target.checked })
                }
              />
              <span className="grille-checkbox" aria-hidden="true">
                {value.extendPattern && <Check size={11} strokeWidth={2.5} />}
              </span>
              <span>
                <strong>Continue across the face</strong>
                <small>Shallow recesses outside the speaker openings.</small>
              </span>
            </label>
            {value.extendPattern &&
              parameter('recessDepth', 'Recess depth', { step: 0.1 })}
          </section>
        </>
      )}
    </div>
  )
}
