import { useNumericDraft } from '@/lib/use-numeric-draft'
import {
  Circle,
  Minus,
  MoveHorizontal,
  RectangleHorizontal,
} from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import {
  getHandleLimits,
  getHandleOutline,
  getHandleHoleCenters,
  normalizeHandleSettings,
  type HandleSettings,
} from '@/lib/handle-settings'
import type { SpeakerModel } from '@/lib/panels'

interface Props {
  model: SpeakerModel
  value: HandleSettings
  onChange: (value: HandleSettings) => void
}

function Parameter({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useNumericDraft(value)
  const commit = () => {
    const numeric = Number(draft)
    const next =
      draft.trim() && Number.isFinite(numeric)
        ? Math.min(max, Math.max(min, numeric))
        : value
    setDraft(String(Number(next.toFixed(2))))
    onChange(next)
  }
  return (
    <div className="handle-parameter">
      <div className="control-label">
        <span className="parameter-name">{label}</span>
        <label className="dimension-input">
          <input
            aria-label={`${label} in millimeters`}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              const next = event.target.valueAsNumber
              if (Number.isFinite(next) && next >= min && next <= max)
                onChange(next)
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commit()
                event.currentTarget.blur()
              }
            }}
          />
          <span aria-hidden="true">mm</span>
        </label>
      </div>
      <Slider
        aria-label={label}
        aria-valuetext={`${Number(value.toFixed(2))} millimeters`}
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

function HandleDiagram({
  model,
  value,
}: {
  model: SpeakerModel
  value: HandleSettings
}) {
  const h = value.height
  const w = value.width
  const outline = getHandleOutline(model, value)
    .map(([x, y]) => `${x},${h / 2 - y}`)
    .join(' ')
  const holes = getHandleHoleCenters(model, value)
  return (
    <div className="handle-diagram" aria-hidden="true">
      <svg viewBox="-72 -49 144 100">
        <defs>
          <pattern
            id="handle-grid"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <circle r=".35" fill="var(--border)" />
          </pattern>
        </defs>
        <rect
          x="-72"
          y="-49"
          width="144"
          height="100"
          fill="url(#handle-grid)"
        />
        <path
          d={`M-42.5 ${h / 2}v5h85v-5`}
          stroke="var(--control-border)"
          fill="var(--muted)"
          strokeWidth=".6"
        />
        <polygon
          points={outline}
          fill="var(--accent-soft)"
          stroke="var(--accent-ink)"
          strokeWidth=".6"
        />
        {holes.map((hole, i) => (
          <rect
            key={i}
            x={hole.x - hole.width / 2}
            y={h / 2 - hole.y - hole.height / 2}
            width={hole.width}
            height={hole.height}
            rx={Math.min(hole.width, hole.height) / 2}
            fill="var(--card)"
            stroke="var(--accent-ink)"
            strokeWidth=".6"
          />
        ))}
        <path
          d={`M${-w / 2} ${-h / 2 - 7}h${w}M${-w / 2} ${-h / 2 - 9}v4M${w / 2} ${-h / 2 - 9}v4`}
          stroke="var(--control-border)"
          strokeWidth=".5"
        />
        <text
          x="0"
          y={-h / 2 - 10}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontSize="4"
          fontFamily="monospace"
        >
          {w} MM
        </text>
      </svg>
      <span>
        HANDLE DETAIL <span>4 MM THICK</span>
      </span>
    </div>
  )
}

export function HandleEditor({ model, value, onChange }: Props) {
  const limits = getHandleLimits(model, value)
  const set = (patch: Partial<HandleSettings>) =>
    onChange(normalizeHandleSettings(model, { ...value, ...patch }))
  const parameter = (
    key:
      | 'height'
      | 'width'
      | 'cornerRadius'
      | 'holeWidth'
      | 'holeHeight'
      | 'holeGap'
      | 'offsetX'
      | 'offsetY',
    label: string,
    step = 1,
  ) => (
    <Parameter
      label={label}
      value={value[key]}
      min={limits[key].min}
      max={limits[key].max}
      step={step}
      onChange={(next) => set({ [key]: next })}
    />
  )
  return (
    <div className="handle-editor">
      <section className="control-section handle-intro">
        <div className="handle-heading">
          <h3>
            <MoveHorizontal size={16} aria-hidden="true" /> Handle
          </h3>
        </div>
        <p>Set the handle dimensions and cutouts.</p>
        <div
          className="handle-mode"
          role="group"
          aria-label="Handle generation mode"
        >
          <button
            type="button"
            aria-pressed={value.mode === 'original'}
            className={value.mode === 'original' ? 'active' : ''}
            onClick={() => set({ mode: 'original' })}
          >
            Original handle
          </button>
          <button
            type="button"
            aria-pressed={value.mode === 'custom'}
            className={value.mode === 'custom' ? 'active' : ''}
            onClick={() => set({ mode: 'custom' })}
          >
            Custom handle
          </button>
        </div>
      </section>
      {value.mode === 'original' ? (
        <div className="handle-original">
          <div className="original-handle-icon" aria-hidden="true">
            <RectangleHorizontal size={60} strokeWidth={1} />
            <Minus size={27} strokeWidth={3} />
          </div>
          <h4>Original handle selected</h4>
          <p>
            Use custom mode to adjust the size, rounded corners, and openings.
          </p>
          <button type="button" onClick={() => set({ mode: 'custom' })}>
            Design your handle <MoveHorizontal size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <HandleDiagram model={model} value={value} />
          <div
            className="handle-presets"
            role="group"
            aria-label="Handle starting points"
          >
            <span>PRESETS</span>
            <button
              type="button"
              onClick={() =>
                set({
                  height: 35,
                  width: 85,
                  cornerRadius: 8,
                  cutout: 'slot',
                  holeCount: 1,
                  holeWidth: 48,
                  holeHeight: 16,
                  holeGap: 6,
                  offsetX: 0,
                  offsetY: 0,
                })
              }
            >
              Carry loop
            </button>
            <button
              type="button"
              onClick={() =>
                set({
                  height: 30,
                  width: 85,
                  cornerRadius: 4,
                  cutout: 'circle',
                  holeCount: 3,
                  holeWidth: 15,
                  holeHeight: 15,
                  holeGap: 7,
                  offsetX: 0,
                  offsetY: 0,
                })
              }
            >
              Three dots
            </button>
            <button
              type="button"
              onClick={() =>
                set({
                  height: 22,
                  width: 85,
                  cornerRadius: 10,
                  cutout: 'none',
                  offsetX: 0,
                  offsetY: 0,
                })
              }
            >
              Solid
            </button>
          </div>
          <section className="control-section handle-shape">
            <h3>
              <span aria-hidden="true">01</span> Dimensions
            </h3>
            {parameter('height', 'Extension height')}
            {parameter('width', 'Handle width')}
            {parameter('cornerRadius', 'Corner radius', 0.5)}
          </section>
          <section className="control-section handle-cutouts">
            <h3>
              <span aria-hidden="true">02</span> Cutouts
            </h3>
            <div
              className="cutout-options"
              role="group"
              aria-label="Hole shape"
            >
              {(
                [
                  { id: 'none', label: 'None', Icon: Minus },
                  { id: 'circle', label: 'Round', Icon: Circle },
                  { id: 'slot', label: 'Slot', Icon: RectangleHorizontal },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={value.cutout === id}
                  className={value.cutout === id ? 'selected' : ''}
                  onClick={() => set({ cutout: id })}
                >
                  <Icon size={17} strokeWidth={1.4} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            {value.cutout !== 'none' && (
              <>
                <div className="hole-count">
                  <span>Number of holes</span>
                  <div role="group" aria-label="Number of holes">
                    {[1, 2, 3].map((count) => (
                      <button
                        type="button"
                        key={count}
                        aria-label={`${count} ${count === 1 ? 'hole' : 'holes'}`}
                        aria-pressed={value.holeCount === count}
                        className={value.holeCount === count ? 'selected' : ''}
                        onClick={() => set({ holeCount: count })}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
                {parameter(
                  'holeWidth',
                  value.cutout === 'circle' ? 'Hole diameter' : 'Hole width',
                )}
                {value.cutout === 'slot' &&
                  parameter('holeHeight', 'Hole height')}
                <details className="handle-placement">
                  <summary>
                    Position & spacing <span aria-hidden="true">+</span>
                  </summary>
                  <div>
                    {value.holeCount > 1 &&
                      parameter('holeGap', 'Hole spacing')}
                    {parameter('offsetX', 'Horizontal offset')}
                    {parameter('offsetY', 'Vertical offset')}
                  </div>
                </details>
              </>
            )}
          </section>
          <p className="handle-footnote">
            Openings keep at least 3 mm of surrounding material. The control
            deck and mounting features stay in place.
          </p>
        </>
      )}
    </div>
  )
}
