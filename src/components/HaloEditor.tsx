import { useEffect, useId, useState } from 'react'
import { ArrowRight, Circle } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import {
  DEFAULT_HALO_SETTINGS,
  HALO_INNER_RADIUS,
  HALO_LIMITS,
  getHaloLimits,
  getHaloCutPivotRadius,
  normalizeHaloSettings,
  type HaloSettings,
} from '@/lib/halo-settings'

interface Props {
  model: 's' | 'm'
  value: HaloSettings
  suppliedHalo: boolean
  onChange: (value: HaloSettings) => void
  onRemove: () => void
  onRestoreSupplied: () => void
}

function HaloParameter({
  label,
  value,
  min,
  max,
  step,
  unit,
  description,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: 'mm' | '°'
  description: string
  onChange: (value: number) => void
}) {
  const descriptionId = useId()
  const [draft, setDraft] = useState(String(Number(value.toFixed(2))))
  useEffect(() => setDraft(String(Number(value.toFixed(2)))), [value])
  const unitName = unit === 'mm' ? 'millimeters' : 'degrees'
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
    <div className="halo-parameter">
      <div className="control-label">
        <span>{label}</span>
        <label className="halo-dimension-input">
          <input
            aria-label={`${label} in ${unitName}`}
            aria-describedby={descriptionId}
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
        aria-describedby={descriptionId}
        aria-valuetext={`${Number(value.toFixed(2))} ${unitName}`}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next)}
      />
      <p id={descriptionId}>{description}</p>
    </div>
  )
}

function HaloDiagram({ value }: { value: HaloSettings }) {
  const flare = Math.tan((value.outwardAngle * Math.PI) / 180)
  const slope = Math.tan((value.cutAngle * Math.PI) / 180)
  const radius = HALO_INNER_RADIUS
  const outerRadius = radius + value.thickness
  const tipRadius = outerRadius + flare * value.depth
  const cutPivotRadius = getHaloCutPivotRadius(value)
  const profile = (direction: 1 | -1, base: boolean) => {
    const inner = direction * radius
    const outer = direction * outerRadius
    const from = base ? 0 : value.rimHeight
    const to = base ? value.rimHeight : value.depth
    if (from === to) return null
    const outline = [
      [from, inner + direction * flare * from],
      [to, inner + direction * flare * to],
      [to, outer + direction * flare * to],
      [from, outer + direction * flare * from],
    ]
    const distance = ([z, radial]: number[]) =>
      z - value.depth - slope * (radial - cutPivotRadius)
    const clipped = base
      ? outline
      : outline.flatMap((point, index) => {
          const previous =
            outline[(index + outline.length - 1) % outline.length]
          const start = distance(previous)
          const end = distance(point)
          const crossing = start <= 0 !== end <= 0
          const intersection = crossing
            ? [
                [
                  previous[0] +
                    ((point[0] - previous[0]) * start) / (start - end),
                  previous[1] +
                    ((point[1] - previous[1]) * start) / (start - end),
                ],
              ]
            : []
          return end <= 0 ? [...intersection, point] : intersection
        })
    if (clipped.length < 3) return null
    return clipped.map(([z, radial]) => `${z + 15},${-radial}`).join(' ')
  }
  const extent = Math.max(45, tipRadius + 8)
  const hasCut = value.cutAngle > 0 && value.rimHeight < value.depth
  return (
    <div className="halo-diagram" aria-hidden="true">
      <svg viewBox={`0 ${-extent} 70 ${extent * 2}`}>
        <path
          d={`M11 ${-outerRadius - 5}v${(outerRadius + 5) * 2}`}
          stroke="var(--control-border)"
          strokeWidth="3"
        />
        <path
          d="M11 0h49"
          stroke="var(--control-border)"
          strokeWidth=".5"
          strokeDasharray="2 2"
        />
        {[1, -1].flatMap((direction) =>
          [false, true].map((base) => {
            const points = profile(direction as 1 | -1, base)
            return points ? (
              <polygon
                key={`${direction}:${base}`}
                points={points}
                fill="var(--accent-soft)"
                stroke="var(--accent-ink)"
                strokeWidth=".7"
              />
            ) : null
          }),
        )}
        <path
          d={`M15 ${extent - 3}h${value.depth}m-${value.depth} -2v4m${value.depth} -4v4`}
          stroke="var(--control-border)"
          strokeWidth=".6"
        />
      </svg>
      <div className="halo-diagram-notes">
        <span>CUT PROFILE</span>
        <strong>{hasCut ? 'Angled hood' : 'Full halo'}</strong>
        <p>
          {value.depth} mm projection
          <br />
          {value.outwardAngle}° outward flare
        </p>
        <span className="halo-direction">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" />
            <path
              d="M12 17V7m-3 3 3-3 3 3"
              transform={`rotate(${value.cutRotation} 12 12)`}
            />
          </svg>
          {hasCut ? `${value.cutRotation}° cut direction` : 'Even rim'}
        </span>
      </div>
    </div>
  )
}

export function HaloEditor({
  model,
  value: input,
  suppliedHalo,
  onChange,
  onRemove,
  onRestoreSupplied,
}: Props) {
  const value = normalizeHaloSettings(input)
  const limits = getHaloLimits(value)
  const set = (patch: Partial<HaloSettings>) =>
    onChange(normalizeHaloSettings({ ...value, ...patch }))
  const parameter = (
    key: keyof typeof HALO_LIMITS,
    label: string,
    unit: 'mm' | '°',
    description: string,
    step = 0.5,
  ) => (
    <HaloParameter
      label={label}
      value={value[key]}
      min={limits[key].min}
      max={limits[key].max}
      step={step}
      unit={unit}
      description={description}
      onChange={(next) => set({ [key]: next })}
    />
  )

  return (
    <div className="halo-editor">
      <section className="control-section halo-intro">
        <div className="halo-heading">
          <h3>
            <Circle size={16} aria-hidden="true" /> Halo
          </h3>
        </div>
        <p>
          {model === 'm'
            ? 'Shape both driver rings, or cut them back into matching rain hoods.'
            : 'Shape the driver ring, or cut it back into a rain hood.'}
        </p>
        <div
          className="halo-mode"
          role="group"
          aria-label="Halo generation mode"
        >
          <button
            type="button"
            aria-label="No halo"
            aria-pressed={value.mode === 'original' && !suppliedHalo}
            onClick={onRemove}
          >
            None
          </button>
          <button
            type="button"
            aria-label="Supplied halo"
            aria-pressed={suppliedHalo}
            onClick={onRestoreSupplied}
          >
            Supplied
          </button>
          <button
            type="button"
            aria-label="Custom halo"
            aria-pressed={value.mode === 'custom'}
            onClick={() => set({ mode: 'custom' })}
          >
            Custom
          </button>
        </div>
      </section>
      {value.mode === 'original' ? (
        <div className="halo-original">
          <div className="halo-original-icon" aria-hidden="true">
            <svg viewBox="0 0 92 80" fill="none">
              <ellipse cx="46" cy="43" rx="29" ry="26" />
              <ellipse cx="49" cy="36" rx="30" ry="27" />
              <ellipse cx="49" cy="36" rx="24" ry="21" />
            </svg>
          </div>
          <h4>
            {suppliedHalo
              ? 'Supplied halo selected'
              : 'No custom halo selected'}
          </h4>
          <p>
            Adjust the outward angle, depth, and wall thickness. Tilt the front
            cut to create a streetlight-style cover.
          </p>
          <button type="button" onClick={() => set({ mode: 'custom' })}>
            Design your halo <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <HaloDiagram value={value} />
          <div
            className="halo-presets"
            role="group"
            aria-label="Halo starting points"
          >
            <span>PRESETS</span>
            <button
              type="button"
              onClick={() => set({ ...DEFAULT_HALO_SETTINGS, mode: 'custom' })}
            >
              Full halo
            </button>
            <button
              type="button"
              onClick={() =>
                set({
                  ...DEFAULT_HALO_SETTINGS,
                  mode: 'custom',
                  depth: 28,
                  cutAngle: 30,
                })
              }
            >
              Rain hood
            </button>
          </div>
          <section className="control-section">
            <h3>
              <span aria-hidden="true">01</span> Ring profile
            </h3>
            {parameter(
              'outwardAngle',
              'Outward angle',
              '°',
              '0° makes a straight wall. Larger angles flare the opening outward.',
            )}
            {parameter(
              'depth',
              'Halo depth',
              'mm',
              'The furthest projection from the front face.',
            )}
            {parameter(
              'thickness',
              'Wall thickness',
              'mm',
              'The radial width of the ring wall.',
              0.1,
            )}
          </section>
          <section className="control-section">
            <h3>
              <span aria-hidden="true">02</span> Front cut
            </h3>
            {parameter(
              'cutAngle',
              'Cutting angle',
              '°',
              `One continuous cut across the rim. Up to ${limits.cutAngle.max}° at this outward angle.`,
            )}
            {parameter(
              'cutRotation',
              'Cut rotation',
              '°',
              '0° places the hood above the driver; 90° turns it to the right.',
              1,
            )}
            {parameter(
              'rimHeight',
              'Rim height',
              'mm',
              '0 mm lets the cut meet the panel flush. Raise it to keep a continuous base rim.',
              0.1,
            )}
          </section>
          <p className="halo-footnote">
            {model === 'm'
              ? 'The same settings apply to both driver openings.'
              : 'The halo surrounds the driver opening.'}{' '}
            Combine with a custom grille.{' '}
            {value.rimHeight === 0
              ? 'The front cut can meet the panel flush.'
              : `A ${value.rimHeight} mm continuous base rim remains after cutting.`}
          </p>
        </>
      )}
    </div>
  )
}
