import { useId } from 'react'
import { Check } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { useNumericDraft } from '@/lib/use-numeric-draft'
import {
  RACE_STRIPE_DEPTH,
  getRaceStripeLimits,
  normalizeRaceStripeSettings,
  type RaceStripeSettings,
} from '@/lib/race-stripe-settings'

function StripeParameter({
  label,
  value,
  min,
  max,
  step = 0.1,
  unit = 'mm',
  description,
  disabled = false,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: 'mm' | ''
  description: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const descriptionId = useId()
  const [draft, setDraft] = useNumericDraft(value)
  const commit = () => {
    const numeric = Number(draft)
    const next =
      draft.trim() && Number.isFinite(numeric)
        ? Math.min(max, Math.max(min, unit ? numeric : Math.round(numeric)))
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
            aria-label={unit ? `${label} in millimeters` : label}
            aria-describedby={descriptionId}
            type="number"
            inputMode={unit ? 'decimal' : 'numeric'}
            min={min}
            max={max}
            step={step}
            disabled={disabled || max <= min}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              const next = event.target.valueAsNumber
              if (
                Number.isFinite(next) &&
                next >= min &&
                next <= max &&
                (unit || Number.isInteger(next)) &&
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
        aria-describedby={descriptionId}
        aria-valuetext={`${value} ${unit ? 'millimeters' : value === 1 ? 'stripe' : 'stripes'}`}
        value={[value]}
        min={min}
        max={Math.max(min + step, max)}
        step={step}
        disabled={disabled || max <= min}
        onValueChange={([next]) => onChange(next)}
      />
      <p id={descriptionId}>{description}</p>
    </div>
  )
}

export function RaceStripeEditor({
  value: input,
  onChange,
}: {
  value: RaceStripeSettings
  onChange: (value: RaceStripeSettings) => void
}) {
  const labelId = useId()
  const descriptionId = useId()
  const value = normalizeRaceStripeSettings(input)
  const limits = getRaceStripeLimits(value)
  const set = (patch: Partial<RaceStripeSettings>) =>
    onChange(normalizeRaceStripeSettings({ ...value, ...patch }))

  return (
    <section className="control-section">
      <h3>
        <span>06</span> Race stripes
      </h3>
      <label className="grille-extension-toggle">
        <input
          type="checkbox"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          checked={value.enabled}
          onChange={(event) => set({ enabled: event.target.checked })}
        />
        <span className="grille-checkbox" aria-hidden="true">
          {value.enabled && <Check size={11} strokeWidth={2.5} />}
        </span>
        <span>
          <strong id={labelId}>Recessed race stripes</strong>
          <small id={descriptionId}>
            Vertical grooves from top to bottom, recessed {RACE_STRIPE_DEPTH} mm
            into the panel. Studs leave the stripes clear.
          </small>
        </span>
      </label>
      {value.enabled && (
        <>
          <StripeParameter
            label="Stripe count"
            value={value.count}
            {...limits.count}
            unit=""
            step={1}
            description="One to three stripes, centered across the panel."
            onChange={(count) => set({ count })}
          />
          <StripeParameter
            label="Stripe width"
            value={value.width}
            {...limits.width}
            description="The width of each recessed stripe."
            onChange={(width) => set({ width })}
          />
          <StripeParameter
            label="Stripe gap"
            value={value.gap}
            {...limits.gap}
            disabled={value.count === 1}
            description={
              value.count === 1
                ? 'Add a second stripe to adjust the gap.'
                : 'Clear material between adjacent stripes. Width and gap fit within the handle.'
            }
            onChange={(gap) => set({ gap })}
          />
        </>
      )}
    </section>
  )
}
