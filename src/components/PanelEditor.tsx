import type { MouseEventHandler } from 'react'
import { ArrowUpRight, Check, CircleHelp } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { PanelIcon } from './PanelIcon'
import { ColorPicker } from './ColorPicker'
import type { Design } from '@/lib/design'
import { getDesignSummary } from '@/lib/design-summary'

const looks = [
  { name: 'The original', panelColor: '#f45427', knobColor: '#303538' },
  { name: 'Fresh perspective', panelColor: '#13b7b1', knobColor: '#eeeae1' },
  { name: 'Less is more', panelColor: '#eeeae1', knobColor: '#13b7b1' },
  { name: 'After hours', panelColor: '#303538', knobColor: '#f45427' },
]

interface Props {
  design: Design
  update: (patch: Partial<Design>) => void
  onOpenGuide: MouseEventHandler<HTMLButtonElement>
}

export function PanelEditor({ design, update, onOpenGuide }: Props) {
  const { styles, currentStyle, customHalo, customGrille, haloLabel } =
    getDesignSummary(design)
  const panelStyleSelected = (style: Design['style']) => design.style === style
  return (
    <>
      <section className="control-section">
        <h3>
          <span>01</span> Panel shape
        </h3>
        <div className="style-options">
          {styles.map((style) => (
            <button
              key={style.id}
              className={`style-option ${panelStyleSelected(style.id) ? 'selected' : ''}`}
              onClick={() => {
                if (style.id === 'original') {
                  update({
                    style: style.id,
                    halo: { ...design.halo, mode: 'original' },
                    grille: { ...design.grille, mode: 'original' },
                  })
                } else {
                  update({ style: style.id })
                }
              }}
              aria-pressed={panelStyleSelected(style.id)}
            >
              <PanelIcon model={design.model} style={style.id} />
              <span>{style.label}</span>
              {panelStyleSelected(style.id) && (
                <Check className="style-check" size={12} />
              )}
            </button>
          ))}
        </div>
        <p className="style-description">
          {customHalo
            ? `${haloLabel}${customGrille ? ' and grille' : ''} active. Edit the profile in Halo, or choose Original to restore the open panel.`
            : customGrille
              ? 'Custom grille active. Edit the pattern in Grille, or choose Original to restore the open panel.'
              : currentStyle.description}
        </p>
      </section>
      <section className="control-section">
        <h3>
          <span>02</span> Colors
        </h3>
        <ColorPicker
          label="Front panel"
          value={design.panelColor}
          onChange={(panelColor) => update({ panelColor })}
        />
        <ColorPicker
          label="Volume knob"
          value={design.knobColor}
          onChange={(knobColor) => update({ knobColor })}
        />
        <p className="subtle-note">
          Preview colors only. Match with your filament.
        </p>
      </section>
      <section className="control-section relief-section">
        <h3>
          <span>03</span> Face depth{' '}
          <button
            className="help-button"
            aria-label="About added face depth"
            onClick={onOpenGuide}
          >
            <CircleHelp size={14} />
          </button>
        </h3>
        <div className="control-label">
          <span id="relief-label">Added face depth</span>
          <span className="value-chip">{design.relief.toFixed(1)} mm</span>
        </div>
        <Slider
          aria-labelledby="relief-label"
          aria-valuetext={`${design.relief.toFixed(1)} millimeters`}
          value={[design.relief]}
          min={0}
          max={2}
          step={0.1}
          onValueChange={([relief]) => update({ relief })}
        />
        <div className="slider-labels">
          <span>Original</span>
          <span>+2 mm</span>
        </div>
      </section>
      <div className="looks-bar">
        <div className="looks-title">
          <span className="section-index">04</span>
          <span>Color presets</span>
        </div>
        <div className="looks">
          {looks.map((look) => (
            <button
              key={look.name}
              className={
                design.panelColor === look.panelColor &&
                design.knobColor === look.knobColor
                  ? 'look selected'
                  : 'look'
              }
              onClick={() =>
                update({
                  panelColor: look.panelColor,
                  knobColor: look.knobColor,
                })
              }
              title={look.name}
              aria-label={`Apply ${look.name} colors`}
              aria-pressed={
                design.panelColor === look.panelColor &&
                design.knobColor === look.knobColor
              }
            >
              <span
                className="look-colors"
                style={{ background: look.panelColor }}
              >
                <i style={{ background: look.knobColor }} />
              </span>
              <span>{look.name}</span>
              <ArrowUpRight size={13} />
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
