import { useNumericDraft } from '@/lib/use-numeric-draft'
import { useId } from 'react'
import { ArrowRight, Check, Circle } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import {
  DEFAULT_HALO_SETTINGS,
  HALO_INNER_RADIUS,
  HALO_LIMITS,
  getHaloLimits,
  getHaloCutPivotRadius,
  createHaloHeightModulator,
  getHaloWaveAmplitude,
  getHaloWaveFrequency,
  getHaloWaveValue,
  normalizeHaloSettings,
  type HaloSettings,
} from '@/lib/halo-settings'

interface Props {
  model: 's' | 'm'
  value: HaloSettings
  onChange: (value: HaloSettings) => void
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
  unit: 'mm' | '°' | 'cycles'
  description: string
  onChange: (value: number) => void
}) {
  const descriptionId = useId()
  const [draft, setDraft] = useNumericDraft(value, 3)
  const unitName =
    unit === 'mm' ? 'millimeters' : unit === '°' ? 'degrees' : 'cycles'
  const commit = () => {
    const numeric = Number(draft)
    const next =
      draft.trim() && Number.isFinite(numeric)
        ? Math.min(max, Math.max(min, numeric))
        : value
    setDraft(String(Number(next.toFixed(3))))
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
            disabled={max <= min}
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
        aria-valuetext={`${Number(value.toFixed(3))} ${unitName}`}
        value={[value]}
        min={min}
        max={Math.max(min + step, max)}
        step={step}
        disabled={max <= min}
        onValueChange={([next]) => onChange(next)}
      />
      <p id={descriptionId}>{description}</p>
    </div>
  )
}

function HaloDiagram({ value }: { value: HaloSettings }) {
  const modulateHeight = createHaloHeightModulator(value)
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
    const angle = value.cutRotation + (direction === 1 ? 0 : 180)
    return clipped
      .map(([z, radial]) => `${modulateHeight(z, angle) + 15},${-radial}`)
      .join(' ')
  }
  const extent = Math.max(45, tipRadius + 8)
  const hasCut = value.cutAngle > 0 && value.rimHeight < value.depth
  const hasWave = value.waveShape !== 'none' && getHaloWaveAmplitude(value) > 0
  return (
    <div className="halo-diagram" aria-hidden="true">
      <svg
        viewBox={`0 ${-extent} ${Math.max(70, value.depth + getHaloWaveAmplitude(value) + 23)} ${extent * 2}`}
      >
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
        <strong>
          {hasWave ? 'Modulated halo' : hasCut ? 'Angled hood' : 'Full halo'}
        </strong>
        <p>
          {value.depth} mm {hasWave ? 'base depth' : 'projection'}
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
          {hasCut
            ? `${value.cutRotation}° cut direction`
            : hasWave
              ? 'Waved rim'
              : 'Even rim'}
        </span>
      </div>
    </div>
  )
}

const WAVEFORMS = [
  ['none', 'Off'],
  ['sine', 'Sine'],
  ['triangle', 'Triangle'],
  ['square', 'Square'],
  ['sawtooth', 'Sawtooth'],
] as const

function WaveformMark({ shape }: { shape: HaloSettings['waveShape'] }) {
  const settings = {
    ...DEFAULT_HALO_SETTINGS,
    waveShape: shape,
    waveFrequency: 1,
  }
  return (
    <svg viewBox="0 0 48 26" fill="none" aria-hidden="true">
      <polyline
        points={Array.from(
          { length: 65 },
          (_, index) =>
            `${3 + (index / 64) * 42},${13 - getHaloWaveValue(settings, (index / 64) * 360) * 9}`,
        ).join(' ')}
      />
    </svg>
  )
}

function HaloWaveDiagram({ value }: { value: HaloSettings }) {
  const modulateHeight = createHaloHeightModulator(value)
  const slope = Math.tan((value.cutAngle * Math.PI) / 180)
  const flare = Math.tan((value.outwardAngle * Math.PI) / 180)
  const pivot = getHaloCutPivotRadius(value)
  const outerRadius = HALO_INNER_RADIUS + value.thickness
  const maxHeight = value.depth + getHaloWaveAmplitude(value)
  const points = Array.from({ length: 513 }, (_, index) => {
    const angle = (index / 512) * 360
    const direction = Math.cos(((angle - value.cutRotation) * Math.PI) / 180)
    const height = Math.max(
      value.rimHeight,
      Math.min(
        value.depth,
        (value.depth - slope * pivot + slope * outerRadius * direction) /
          (1 - slope * flare * direction),
      ),
    )
    const x = 6 + (index / 512) * 268
    return {
      base: `${x},${66 - (height / maxHeight) * 58}`,
      wave: `${x},${66 - (modulateHeight(height, angle) / maxHeight) * 58}`,
    }
  })
  const frequency = getHaloWaveFrequency(value)
  return (
    <div className="halo-wave-preview">
      <div>
        <span>HEIGHT AROUND THE HALO</span>
        <strong>
          {Number(frequency.toFixed(2))} {frequency === 1 ? 'cycle' : 'cycles'}
        </strong>
      </div>
      <svg
        viewBox="0 0 280 76"
        role="img"
        aria-label="Halo rim height around one full turn, with the original cut profile shown as a dashed line"
      >
        <path d="M6 66H274" className="halo-wave-baseline" />
        <polygon
          points={`6,66 ${points.map((point) => point.wave).join(' ')} 274,66`}
        />
        <polyline
          points={points.map((point) => point.base).join(' ')}
          className="halo-wave-before"
        />
        <polyline
          points={points.map((point) => point.wave).join(' ')}
          className="halo-wave-after"
        />
      </svg>
      <div>
        <span>0° · TOP</span>
        <span>180° · BOTTOM</span>
        <span>360°</span>
      </div>
    </div>
  )
}

export function HaloEditor({ model, value: input, onChange }: Props) {
  const seamlessLabelId = useId()
  const seamlessDescriptionId = useId()
  const value = normalizeHaloSettings(input)
  const limits = getHaloLimits(value)
  const set = (patch: Partial<HaloSettings>) =>
    onChange(normalizeHaloSettings({ ...value, ...patch }))
  const parameter = (
    key: keyof typeof HALO_LIMITS,
    label: string,
    unit: 'mm' | '°' | 'cycles',
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
            ? 'Shape both driver rings with an angled cut and waves around the rim.'
            : 'Shape the driver ring with an angled cut and waves around the rim.'}
        </p>
        <div
          className="halo-mode"
          role="group"
          aria-label="Halo generation mode"
        >
          <button
            type="button"
            aria-label="Original halo"
            aria-pressed={value.mode === 'original'}
            onClick={() => set({ mode: 'original' })}
          >
            Original
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
          <h4>No custom halo selected</h4>
          <p>
            Adjust the outward angle, depth, and wall thickness. Tilt the front
            cut to create a streetlight-style cover, then modulate its height
            with a wave.
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
              'The furthest projection before wave modulation.',
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
          <section className="control-section halo-wave-section">
            <h3>
              <span aria-hidden="true">03</span> Height modulation
            </h3>
            <p className="halo-wave-intro">
              Add a wave to the current halo and its cut. The base rim stays
              fixed.
            </p>
            <div
              className="halo-wave-options"
              role="group"
              aria-label="Halo waveform"
            >
              {WAVEFORMS.map(([shape, label]) => (
                <button
                  key={shape}
                  type="button"
                  aria-pressed={value.waveShape === shape}
                  onClick={() => set({ waveShape: shape })}
                >
                  <WaveformMark shape={shape} />
                  {label}
                </button>
              ))}
            </div>
            {value.waveShape !== 'none' && (
              <>
                <HaloWaveDiagram value={value} />
                {parameter(
                  'waveAmplitude',
                  'Wave amplitude',
                  'mm',
                  value.rimHeight >= value.depth
                    ? 'Lower the rim height below the halo depth to make room for a wave.'
                    : 'Rise and fall at the full-height tip. Shorter cut sections scale proportionally; the base rim stays fixed.',
                  0.1,
                )}
                {parameter(
                  'waveFrequency',
                  'Wave frequency',
                  'cycles',
                  value.waveSeamless
                    ? `Snaps to ${getHaloWaveFrequency(value)} whole ${getHaloWaveFrequency(value) === 1 ? 'cycle' : 'cycles'} around the ring.`
                    : 'Cycles around one full turn. Fractional cycles create a transition where the ends meet.',
                  0.05,
                )}
                <label className="grille-extension-toggle halo-seamless-toggle">
                  <input
                    type="checkbox"
                    aria-labelledby={seamlessLabelId}
                    aria-describedby={seamlessDescriptionId}
                    checked={value.waveSeamless}
                    onChange={(event) =>
                      set({ waveSeamless: event.target.checked })
                    }
                  />
                  <span className="grille-checkbox" aria-hidden="true">
                    {value.waveSeamless && (
                      <Check size={11} strokeWidth={2.5} />
                    )}
                  </span>
                  <span>
                    <strong id={seamlessLabelId}>Seamless loop</strong>
                    <small id={seamlessDescriptionId}>
                      Use the nearest whole frequency so the wave repeats evenly
                      around the halo.
                    </small>
                  </span>
                </label>
                {parameter(
                  'wavePhase',
                  'Wave phase',
                  '°',
                  'Shift the wave through its cycle. One full cycle is 360°; the ring starts at the top and runs clockwise.',
                  1,
                )}
              </>
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
