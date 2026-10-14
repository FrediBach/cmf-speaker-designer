import { useEffect, useId, useRef, useState } from 'react'
import { useNumericDraft } from '@/lib/use-numeric-draft'
import {
  Circle,
  Check,
  Minus,
  MoveHorizontal,
  RectangleHorizontal,
  FileUp,
  Upload,
  X,
} from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import {
  getHandleLimits,
  getHandleOutline,
  getHandleHoleCenters,
  getHandleSvgPaths,
  getHandleStudCenters,
  HANDLE_STUD_DIAMETER,
  HANDLE_STUD_HEIGHT,
  HANDLE_STUD_PITCH,
  normalizeHandleSettings,
  type HandleSettings,
} from '@/lib/handle-settings'
import type { SpeakerModel } from '@/lib/panels'
import { SVG_MAX_FILE_SIZE, type SvgCutout } from '@/lib/svg-cutout'
import {
  getRaceStripeIntervals,
  type RaceStripeSettings,
} from '@/lib/race-stripe-settings'

interface Props {
  model: SpeakerModel
  value: HandleSettings
  panelExtension: number
  raceStripes: RaceStripeSettings
  onChange: (value: HandleSettings) => void
}

function TopSlitsIcon({ size = 17, strokeWidth = 1.4 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5v15h18V5h-4v9a1.5 1.5 0 0 1-3 0V5h-4v9a1.5 1.5 0 0 1-3 0V5Z" />
    </svg>
  )
}

function SvgUpload({
  value,
  onChange,
}: {
  value: SvgCutout | null
  onChange: (value: SvgCutout | null) => void
}) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const request = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const latestChange = useRef(onChange)
  useEffect(() => {
    latestChange.current = onChange
  }, [onChange])
  useEffect(
    () => () => {
      request.current += 1
    },
    [],
  )

  async function upload(file: File) {
    const id = ++request.current
    setError('')
    setLoading(true)
    try {
      if (!/\.svg$/i.test(file.name))
        throw new Error('Choose an SVG file for your cutout.')
      if (file.size > SVG_MAX_FILE_SIZE)
        throw new Error('Choose an SVG smaller than 256 KB.')
      const { parseSvgCutout } = await import('@/lib/svg-cutout-parser')
      const cutout = parseSvgCutout(await file.text(), file.name)
      if (id === request.current) latestChange.current(cutout)
    } catch (cause) {
      if (id === request.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'This SVG could not be read.',
        )
    } finally {
      if (id === request.current) setLoading(false)
    }
  }

  return (
    <div className="svg-upload" aria-busy={loading}>
      <p id="svg-cutout-help">
        Filled shapes become cutouts. Convert text and strokes to filled paths
        before uploading. SVG, up to 256 KB.
      </p>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".svg,image/svg+xml"
        aria-label="Upload SVG cutout"
        aria-describedby="svg-cutout-help"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void upload(file)
        }}
      />
      <button
        className="svg-upload-button"
        type="button"
        disabled={loading}
        onClick={() => input.current?.click()}
      >
        <Upload size={16} aria-hidden="true" />
        {loading ? 'Reading SVG…' : value ? 'Replace SVG' : 'Upload SVG'}
      </button>
      {value && (
        <div className="svg-upload-file">
          <span title={value.name}>{value.name}</span>
          <button
            type="button"
            aria-label="Remove SVG cutout"
            onClick={() => {
              request.current += 1
              setLoading(false)
              setError('')
              onChange(null)
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {error && (
        <p className="svg-upload-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
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
  panelExtension,
  raceStripes,
}: {
  model: SpeakerModel
  value: HandleSettings
  panelExtension: number
  raceStripes: RaceStripeSettings
}) {
  const stripeClipId = useId()
  const h = value.height
  const w = value.width
  const baseWidth = 84.9715 + panelExtension * 2
  const outline = getHandleOutline(model, value, baseWidth)
    .map(([x, y]) => `${x},${h / 2 - y}`)
    .join(' ')
  const holes = getHandleHoleCenters(model, value)
  const svgPaths = getHandleSvgPaths(model, value)
  const studs = getHandleStudCenters(model, value, raceStripes)
  return (
    <div className="handle-diagram" aria-hidden="true">
      <svg viewBox="-72 -49 144 100">
        <defs>
          <clipPath id={stripeClipId}>
            <polygon points={outline} />
          </clipPath>
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
          d={`M${-baseWidth / 2} ${h / 2}v5h${baseWidth}v-5`}
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
        <g clipPath={`url(#${stripeClipId})`}>
          {getRaceStripeIntervals(raceStripes).map(({ minX, maxX }) => (
            <rect
              key={minX}
              x={minX}
              y={-h / 2}
              width={maxX - minX}
              height={h + 0.25}
              fill="var(--accent-ink)"
              opacity=".18"
            />
          ))}
        </g>
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
        {svgPaths.map((path, index) => (
          <path
            key={index}
            d={path.contours
              .map(
                (contour) =>
                  `${contour.map(([x, y], point) => `${point ? 'L' : 'M'}${x},${h / 2 - y}`).join(' ')}Z`,
              )
              .join(' ')}
            fillRule={path.fillRule}
            fill="var(--card)"
            stroke="var(--accent-ink)"
            strokeWidth=".6"
          />
        ))}
        {studs.map(({ x, y }) => (
          <circle
            key={`${x}:${y}`}
            cx={x}
            cy={h / 2 - y}
            r={HANDLE_STUD_DIAMETER / 2}
            fill="var(--accent-ink)"
            fillOpacity=".2"
            stroke="var(--accent-ink)"
            strokeWidth=".5"
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
        HANDLE DETAIL <span>4 MM {value.legoStuds ? 'BASE' : 'THICK'}</span>
      </span>
    </div>
  )
}

export function HandleEditor({
  model,
  value,
  panelExtension,
  raceStripes,
  onChange,
}: Props) {
  const studsLabelId = useId()
  const studsDescriptionId = useId()
  const limits = getHandleLimits(model, value)
  const isSlits = value.cutout === 'slits'
  const studCount = getHandleStudCenters(model, value, raceStripes).length
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
        <p>Set the handle dimensions, cutouts, and surface studs.</p>
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
            Adjust the size, rounded corners, and openings, or add
            LEGO-compatible studs in custom mode.
          </p>
          <button type="button" onClick={() => set({ mode: 'custom' })}>
            Design your handle <MoveHorizontal size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          <HandleDiagram
            model={model}
            value={value}
            panelExtension={panelExtension}
            raceStripes={raceStripes}
          />
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
                  height: 35,
                  width: 85,
                  cornerRadius: 8,
                  cutout: 'slits',
                  holeCount: 5,
                  holeWidth: 5,
                  holeHeight: 23,
                  holeGap: 8,
                  offsetX: 0,
                  offsetY: 0,
                })
              }
            >
              Hair
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
            <p className="subtle-note">
              Handle width is independent of the panel’s side extension.
            </p>
          </section>
          <section className="control-section handle-cutouts">
            <h3>
              <span aria-hidden="true">02</span> Cutouts
            </h3>
            <div
              className="cutout-options handle-cutout-options"
              role="group"
              aria-label="Hole shape"
            >
              {(
                [
                  { id: 'none', label: 'None', Icon: Minus },
                  { id: 'circle', label: 'Round', Icon: Circle },
                  { id: 'slot', label: 'Slot', Icon: RectangleHorizontal },
                  { id: 'slits', label: 'Top slits', Icon: TopSlitsIcon },
                  { id: 'svg', label: 'SVG', Icon: FileUp },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={value.cutout === id}
                  className={value.cutout === id ? 'selected' : ''}
                  onClick={() =>
                    set(
                      id === 'slits' && !isSlits
                        ? {
                            cutout: id,
                            holeCount: 5,
                            holeWidth: 5,
                            holeHeight: Math.round(value.height * 0.65),
                            holeGap: 8,
                            offsetX: 0,
                            offsetY: 0,
                          }
                        : { cutout: id },
                    )
                  }
                >
                  <Icon size={17} strokeWidth={1.4} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            {value.cutout === 'svg' && (
              <>
                <SvgUpload
                  key={model}
                  value={value.svgCutout}
                  onChange={(svgCutout) =>
                    set({
                      svgCutout,
                      holeWidth: value.svgCutout ? value.holeWidth : 40,
                      offsetX: 0,
                      offsetY: 0,
                    })
                  }
                />
                {value.svgCutout && (
                  <>
                    {parameter('holeWidth', 'Cutout width', 0.5)}
                    <p className="svg-cutout-size">
                      {Number(value.holeWidth.toFixed(2))} ×{' '}
                      {Number(value.holeHeight.toFixed(2))} mm · proportions
                      locked
                    </p>
                    <details className="handle-placement">
                      <summary>
                        Position <span aria-hidden="true">+</span>
                      </summary>
                      <div>
                        {parameter('offsetX', 'Horizontal offset', 0.5)}
                        {parameter('offsetY', 'Vertical offset', 0.5)}
                      </div>
                    </details>
                  </>
                )}
              </>
            )}
            {(value.cutout === 'circle' ||
              value.cutout === 'slot' ||
              isSlits) && (
              <>
                {isSlits && (
                  <p className="subtle-note">
                    Rounded slits open from the top to give the panel a
                    hair-like silhouette.
                  </p>
                )}
                <div className={`hole-count${isSlits ? ' slit-count' : ''}`}>
                  <span>{isSlits ? 'Number of slits' : 'Number of holes'}</span>
                  <div
                    role="group"
                    aria-label={isSlits ? 'Number of slits' : 'Number of holes'}
                  >
                    {Array.from(
                      { length: limits.holeCount.max },
                      (_, index) => index + 1,
                    ).map((count) => (
                      <button
                        type="button"
                        key={count}
                        aria-label={`${count} ${isSlits ? (count === 1 ? 'slit' : 'slits') : count === 1 ? 'hole' : 'holes'}`}
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
                  isSlits
                    ? 'Slit width'
                    : value.cutout === 'circle'
                      ? 'Hole diameter'
                      : 'Hole width',
                )}
                {(value.cutout === 'slot' || isSlits) &&
                  parameter(
                    'holeHeight',
                    isSlits ? 'Slit depth' : 'Hole height',
                  )}
                <details className="handle-placement">
                  <summary>
                    Position & spacing <span aria-hidden="true">+</span>
                  </summary>
                  <div>
                    {value.holeCount > 1 &&
                      parameter(
                        'holeGap',
                        isSlits ? 'Slit spacing' : 'Hole spacing',
                      )}
                    {parameter('offsetX', 'Horizontal offset')}
                    {!isSlits && parameter('offsetY', 'Vertical offset')}
                  </div>
                </details>
              </>
            )}
          </section>
          <section className="control-section handle-studs">
            <h3>
              <span aria-hidden="true">03</span> Surface studs
            </h3>
            <label className="handle-studs-toggle">
              <input
                type="checkbox"
                aria-labelledby={studsLabelId}
                aria-describedby={studsDescriptionId}
                checked={value.legoStuds}
                onChange={(event) => set({ legoStuds: event.target.checked })}
              />
              <span className="handle-checkbox" aria-hidden="true">
                {value.legoStuds && <Check size={11} strokeWidth={2.5} />}
              </span>
              <span>
                <strong id={studsLabelId}>LEGO-compatible studs</strong>
                <small id={studsDescriptionId}>
                  Add studs to the front of the handle, avoiding{' '}
                  {raceStripes.enabled
                    ? 'edges, cutouts, and race stripes'
                    : 'edges and cutouts'}
                  .
                </small>
              </span>
            </label>
            {value.legoStuds && (
              <p className="handle-studs-detail" role="status">
                {studCount > 0
                  ? `${studCount} studs · ${HANDLE_STUD_DIAMETER} mm diameter · ${HANDLE_STUD_HEIGHT} mm high · ${HANDLE_STUD_PITCH} mm spacing`
                  : 'No studs fit this shape. Enlarge the handle or reduce the cutout or stripes.'}
              </p>
            )}
          </section>
          <p className="handle-footnote">
            {value.cutout === 'svg'
              ? 'Your SVG fits inside a 3 mm outer border. Use a stencil shape without floating islands, and leave enough material between its details.'
              : isSlits
                ? 'Slits open at the top, with rounded bottoms and at least 3 mm of material between them and above the attachment shoulder.'
                : 'Openings keep at least 3 mm of surrounding material. The control deck and mounting features stay in place.'}
          </p>
        </>
      )}
    </div>
  )
}
