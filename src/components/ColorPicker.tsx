import { Check, CirclePlus } from 'lucide-react'
import { PALETTE, colorName } from '@/lib/design'

export function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="color-picker">
      <div className="control-label">
        <span className="color-label">{label}</span>
        <span>{colorName(value)}</span>
      </div>
      <div className="swatches" role="group" aria-label={`${label} color`}>
        {PALETTE.map((color) => (
          <button
            key={color.value}
            className={`swatch ${value.toLowerCase() === color.value ? 'selected' : ''}`}
            style={{ '--swatch': color.value } as React.CSSProperties}
            onClick={() => onChange(color.value)}
            aria-label={`${label}: ${color.name}`}
            aria-pressed={value.toLowerCase() === color.value}
            title={color.name}
          >
            {value.toLowerCase() === color.value && (
              <Check
                size={15}
                strokeWidth={2}
                color={
                  !['#303538', '#5573ce'].includes(color.value)
                    ? '#303538'
                    : '#fff'
                }
              />
            )}
          </button>
        ))}
        <label
          className="custom-swatch"
          title={`Choose a custom ${label.toLowerCase()} color`}
        >
          <CirclePlus size={19} strokeWidth={1.4} />
          <input
            type="color"
            aria-label={`Custom ${label.toLowerCase()} color`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      </div>
    </div>
  )
}
