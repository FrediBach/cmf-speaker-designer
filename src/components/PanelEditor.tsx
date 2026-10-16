import { useId, type MouseEventHandler } from 'react'
import { ArrowUpRight, Check, CircleHelp } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { PanelIcon } from './PanelIcon'
import { ColorPicker } from './ColorPicker'
import type { Design } from '@/lib/design'
import { getDesignSummary } from '@/lib/design-summary'
import { RaceStripeEditor } from './RaceStripeEditor'
import { MulticolorEditor } from './MulticolorEditor'
import type { BufferGeometry } from 'three'
import { getDefaultMulticolorSettings } from '@/lib/multicolor-settings'

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
  geometry: BufferGeometry | null
  materialCount: number | null
  patternNotes: string[]
  patternError: string
  onBeginTransaction: () => void
  onEndTransaction: () => void
}

export function PanelEditor({
  design,
  update,
  onOpenGuide,
  geometry,
  materialCount,
  patternNotes,
  patternError,
  onBeginTransaction,
  onEndTransaction,
}: Props) {
  const panelExtensionCm = design.panelExtension / 10
  const panelGapCm = design.panelGap / 10
  const splitLabelId = useId()
  const splitDescriptionId = useId()
  return (
    <>
      <PanelShapeControls design={design} update={update} />
      <PanelColorControls
        design={design}
        update={update}
        geometry={geometry}
        materialCount={materialCount}
        patternNotes={patternNotes}
        patternError={patternError}
        onBeginTransaction={onBeginTransaction}
        onEndTransaction={onEndTransaction}
      />
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
      <section className="control-section">
        <h3>
          <span>04</span> Panel width
        </h3>
        <div className="control-label">
          <span id="panel-extension-label">Side extension</span>
          <span className="value-chip">
            {panelExtensionCm.toFixed(2)} cm per side
          </span>
        </div>
        <Slider
          aria-labelledby="panel-extension-label"
          aria-valuetext={`${panelExtensionCm.toFixed(2)} centimeters per side`}
          value={[panelExtensionCm]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={([extensionCm]) =>
            update({ panelExtension: Math.round(extensionCm * 100) / 10 })
          }
        />
        <div className="slider-labels">
          <span>0 cm</span>
          <span>1 cm</span>
        </div>
        <p className="subtle-note">
          Extends the front and angled section on both sides. Set the handle
          width in the Handle tab.
        </p>
      </section>
      <section className="control-section">
        <h3>
          <span>05</span> Panel spacing
        </h3>
        <div className="control-label">
          <span id="panel-gap-label">Panel gap</span>
          <span className="value-chip">{panelGapCm.toFixed(2)} cm</span>
        </div>
        <Slider
          aria-labelledby="panel-gap-label"
          aria-valuetext={`${panelGapCm.toFixed(2)} centimeters`}
          value={[panelGapCm]}
          min={0}
          max={0.5}
          step={0.01}
          onValueChange={([gapCm]) =>
            update({ panelGap: Math.round(gapCm * 100) / 10 })
          }
        />
        <div className="slider-labels">
          <span>0 cm</span>
          <span>0.5 cm</span>
        </div>
        <p className="subtle-note">
          Adds space behind the panel with extended attachments and rear support
          posts. The knob and button stay in recessed openings.
        </p>
      </section>
      <section className="control-section">
        <h3>
          <span>06</span> Print assembly
        </h3>
        <label className="grille-extension-toggle">
          <input
            type="checkbox"
            aria-labelledby={splitLabelId}
            aria-describedby={splitDescriptionId}
            checked={design.panelSplit}
            onChange={(event) => update({ panelSplit: event.target.checked })}
          />
          <span className="grille-checkbox" aria-hidden="true">
            {design.panelSplit && <Check size={11} strokeWidth={2.5} />}
          </span>
          <span>
            <strong id={splitLabelId}>Split front and upper panel</strong>
            <small id={splitDescriptionId}>
              Print two parts, joined where the angled section starts. The upper
              part slides down into a groove inside the front plate's top edge,
              keeping the back flush.
            </small>
          </span>
        </label>
        {design.panelSplit && (
          <p className="subtle-note">
            Fit the parts together before mounting the panel. Check the first
            print's sliding fit and strength before using the handle.
          </p>
        )}
      </section>
      <RaceStripeEditor
        value={design.raceStripes}
        onChange={(raceStripes) => update({ raceStripes })}
      />
      <div className="looks-bar">
        <div className="looks-title">
          <span className="section-index">08</span>
          <span>Color presets</span>
        </div>
        <div className="looks">
          {looks.map((look) => (
            <button
              key={look.name}
              className={
                design.panelColor === look.panelColor &&
                design.powerButtonColor === look.panelColor &&
                design.knobColor === look.knobColor
                  ? 'look selected'
                  : 'look'
              }
              onClick={() =>
                update({
                  panelColor: look.panelColor,
                  powerButtonColor: look.panelColor,
                  knobColor: look.knobColor,
                })
              }
              title={look.name}
              aria-label={`Apply ${look.name} colors`}
              aria-pressed={
                design.panelColor === look.panelColor &&
                design.powerButtonColor === look.panelColor &&
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

function PanelShapeControls({
  design,
  update,
}: Pick<Props, 'design' | 'update'>) {
  const { styles, currentStyle, customHalo, customGrille, haloLabel } =
    getDesignSummary(design)
  const panelStyleSelected = (style: Design['style']) => design.style === style
  return (
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
                  raceStripes: { ...design.raceStripes, enabled: false },
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
            : design.raceStripes.enabled
              ? 'Recessed race stripes active. Edit their width and spacing below, or choose Original to restore the open panel.'
              : currentStyle.description}
      </p>
    </section>
  )
}

function PanelColorControls({
  design,
  update,
  geometry,
  materialCount,
  patternNotes,
  patternError,
  onBeginTransaction,
  onEndTransaction,
}: Omit<Props, 'onOpenGuide'>) {
  return (
    <section className="control-section">
      <h3>
        <span>02</span> Colors
      </h3>
      <div className="handle-mode" role="group" aria-label="Panel color mode">
        {[false, true].map((enabled) => (
          <button
            key={String(enabled)}
            aria-pressed={design.multicolor.enabled === enabled}
            className={design.multicolor.enabled === enabled ? 'active' : ''}
            onClick={() => {
              const empty =
                !design.multicolor.elements.length &&
                !design.multicolor.groups.length &&
                !design.multicolor.materials.length
              const untouched = ['s', 'm'].some(
                (model) =>
                  JSON.stringify(design.multicolor.frame) ===
                  JSON.stringify(
                    getDefaultMulticolorSettings(model as Design['model'])
                      .frame,
                  ),
              )
              const frame =
                enabled && empty && untouched
                  ? getDefaultMulticolorSettings(design.model).frame
                  : design.multicolor.frame
              update({ multicolor: { ...design.multicolor, frame, enabled } })
            }}
          >
            {enabled ? 'Multicolor' : 'Single color'}
          </button>
        ))}
      </div>
      <ColorPicker
        label={design.multicolor.enabled ? 'Background' : 'Front panel'}
        value={design.panelColor}
        onChange={(panelColor) => update({ panelColor })}
      />
      <ColorPicker
        label="Power button"
        value={design.powerButtonColor}
        onChange={(powerButtonColor) => update({ powerButtonColor })}
      />
      <ColorPicker
        label="Volume knob"
        value={design.knobColor}
        onChange={(knobColor) => update({ knobColor })}
      />
      <p className="subtle-note">
        {design.multicolor.enabled
          ? 'Assign these colors to filaments in your slicer.'
          : 'Choose matching filament in your slicer. 3MF includes these colors.'}
      </p>
      {design.multicolor.enabled && (
        <>
          <p className="subtle-note" role="status">
            {patternError
              ? 'Material regions could not update. Adjust the pattern or use Retry below.'
              : materialCount === null
                ? 'Updating printable material regions…'
                : `${materialCount} printable material${materialCount === 1 ? '' : 's'} on this panel. Match these to your printer’s available filament slots.`}
          </p>
          {!!patternNotes.length && (
            <details className="multicolor-pattern-notes">
              <summary>Pattern notes ({patternNotes.length})</summary>
              {patternNotes.map((note, index) => (
                <p className="subtle-note" key={index}>
                  {note}
                </p>
              ))}
            </details>
          )}
          <MulticolorEditor
            value={design.multicolor}
            onChange={(multicolor) => update({ multicolor })}
            panelColor={design.panelColor}
            onPanelColorChange={(panelColor) => update({ panelColor })}
            model={design.model}
            geometry={geometry}
            onBeginTransaction={onBeginTransaction}
            onEndTransaction={onEndTransaction}
          />
        </>
      )}
    </section>
  )
}
