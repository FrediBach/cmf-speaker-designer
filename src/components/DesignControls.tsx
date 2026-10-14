import type { MouseEventHandler } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  LoaderCircle,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from './ui/button'
import { PanelIcon } from './PanelIcon'
import { PanelEditor } from './PanelEditor'
import { HaloEditor } from './HaloEditor'
import { GrilleEditor } from './GrilleEditor'
import { HandleEditor } from './HandleEditor'
import { KnobEditor } from './KnobEditor'
import { BODY_COLORS, type Design } from '@/lib/design'
import type { useDesignGeometry } from '@/lib/use-design-geometry'
import type { useDesignInteractions } from '@/lib/use-design-interactions'
import type { SpeakerPreviewProps } from './SpeakerPreview'

const EDITOR_TABS = [
  { id: 'panel', label: 'Front panel' },
  { id: 'halo', label: 'Halo' },
  { id: 'grille', label: 'Grille' },
  { id: 'handle', label: 'Handle' },
  { id: 'knob', label: 'Knob' },
] as const

type EditorTab = (typeof EDITOR_TABS)[number]['id']
interface Props {
  design: Design
  update: (patch: Partial<Design>) => void
  editorTab: EditorTab
  setEditorTab: (tab: EditorTab) => void
  assembly: NonNullable<SpeakerPreviewProps['assembly']>
  setAssembly: (assembly: NonNullable<SpeakerPreviewProps['assembly']>) => void
  meshes: ReturnType<typeof useDesignGeometry>
  interactionHandlers: ReturnType<typeof useDesignInteractions>
  onOpenGuide: MouseEventHandler<HTMLButtonElement>
  onOpenExport: MouseEventHandler<HTMLButtonElement>
  onReset: () => void
  onRandomize: () => void
  onRetry: () => void
}

export function DesignControls({
  design,
  update,
  editorTab,
  setEditorTab,
  assembly,
  setAssembly,
  meshes,
  interactionHandlers,
  onOpenGuide,
  onOpenExport,
  onReset,
  onRandomize,
  onRetry,
}: Props) {
  const { geometry, knobGeometry, error, knobError } = meshes
  return (
    <aside
      className="controls"
      id="design-controls"
      aria-label="Design controls"
      aria-description="Undo with Command or Control plus Z. Redo with Command or Control plus Shift plus Z, or Control plus Y."
      tabIndex={-1}
      {...interactionHandlers}
    >
      <div className="controls-heading">
        <div className="controls-heading-title">
          <SlidersHorizontal size={17} />
          <h2>Design controls</h2>
        </div>
        <div className="design-actions">
          <button
            className="text-button"
            onClick={onRandomize}
            title="Randomize all settings for the selected speaker. Undo with ⌘/Ctrl+Z."
          >
            <Shuffle size={12} aria-hidden="true" /> Randomize
          </button>
          <button
            className="text-button"
            onClick={onReset}
            title="Reset all settings for the selected speaker"
          >
            <RotateCcw size={12} aria-hidden="true" /> Reset
          </button>
        </div>
      </div>
      <section className="control-section model-section">
        <h3>
          <span>01</span> Speaker model
        </h3>
        <div className="model-options">
          {(['s', 'm'] as const).map((model) => (
            <button
              key={model}
              aria-pressed={design.model === model}
              className={`model-option ${design.model === model ? 'selected' : ''}`}
              onClick={() => update({ model })}
            >
              <PanelIcon model={model} />
              <span>
                Speaker {model.toUpperCase()}
                <small>{model === 's' ? '85 × 131 mm' : '85 × 225 mm'}</small>
              </span>
              <span className="radio-indicator">
                {design.model === model && <span />}
              </span>
            </button>
          ))}
        </div>
        <div className="body-color-control">
          <span id="body-color-label">Speaker body</span>
          <div
            className="body-color-options"
            role="group"
            aria-labelledby="body-color-label"
          >
            {(['black', 'gray'] as const).map((bodyColor) => (
              <button
                key={bodyColor}
                type="button"
                aria-label={`Speaker body: ${BODY_COLORS[bodyColor].label}`}
                aria-pressed={design.bodyColor === bodyColor}
                title={
                  bodyColor === 'gray'
                    ? 'Gray body (white speaker)'
                    : 'Black body'
                }
                onClick={() => update({ bodyColor })}
              >
                <span
                  className="body-color-swatch"
                  style={{ background: BODY_COLORS[bodyColor].shell }}
                  aria-hidden="true"
                />
                {BODY_COLORS[bodyColor].label}
              </button>
            ))}
          </div>
        </div>
      </section>
      <div className="editor-tabs" role="tablist" aria-label="Design area">
        {EDITOR_TABS.map(({ id: tab, label }, index) => (
          <button
            key={tab}
            role="tab"
            aria-label={label}
            id={`${tab}-tab`}
            aria-controls={`${tab}-editor`}
            aria-selected={editorTab === tab}
            tabIndex={editorTab === tab ? 0 : -1}
            onKeyDown={(event) => {
              if (
                ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              ) {
                event.preventDefault()
                const nextIndex =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? EDITOR_TABS.length - 1
                      : (index +
                          (event.key === 'ArrowRight' ? 1 : -1) +
                          EDITOR_TABS.length) %
                        EDITOR_TABS.length
                const next = EDITOR_TABS[nextIndex].id
                setEditorTab(next)
                if (next === 'knob') setAssembly('knob')
                else if (assembly === 'knob') setAssembly('assembled')
                document.getElementById(`${next}-tab`)?.focus()
              }
            }}
            onClick={() => {
              setEditorTab(tab)
              if (tab === 'knob') setAssembly('knob')
              else if (assembly === 'knob') setAssembly('assembled')
            }}
          >
            {tab === 'panel' ? 'Panel' : label}
          </button>
        ))}
      </div>
      <div
        className="controls-scroll"
        key={editorTab}
        role="region"
        aria-label={`${EDITOR_TABS.find((tab) => tab.id === editorTab)?.label} parameters`}
        tabIndex={0}
      >
        <div
          id="panel-editor"
          role="tabpanel"
          aria-labelledby="panel-tab"
          hidden={editorTab !== 'panel'}
        >
          <PanelEditor
            design={design}
            update={update}
            onOpenGuide={onOpenGuide}
          />
        </div>
        <div
          id="halo-editor"
          role="tabpanel"
          aria-labelledby="halo-tab"
          hidden={editorTab !== 'halo'}
        >
          <HaloEditor
            model={design.model}
            value={design.halo}
            onChange={(halo) => update({ halo })}
          />
        </div>
        <div
          id="grille-editor"
          role="tabpanel"
          aria-labelledby="grille-tab"
          hidden={editorTab !== 'grille'}
        >
          <GrilleEditor
            model={design.model}
            value={design.grille}
            raceStripes={design.raceStripes}
            onChange={(grille) => update({ grille })}
          />
        </div>
        <div
          id="handle-editor"
          role="tabpanel"
          aria-labelledby="handle-tab"
          hidden={editorTab !== 'handle'}
        >
          <HandleEditor
            model={design.model}
            value={design.handle}
            panelExtension={design.panelExtension}
            raceStripes={design.raceStripes}
            onChange={(handle) => update({ handle })}
          />
        </div>
        <div
          id="knob-editor"
          role="tabpanel"
          aria-labelledby="knob-tab"
          hidden={editorTab !== 'knob'}
        >
          <KnobEditor
            value={design.knob}
            onChange={(knob) => update({ knob })}
            color={design.knobColor}
            onColorChange={(knobColor) => update({ knobColor })}
          />
        </div>
      </div>
      <div className="export-section">
        <div className="export-spec">
          <span>
            <Box size={13} /> STL / STP
          </span>
          <span>1:1 SCALE · MM</span>
        </div>
        {error || knobError ? (
          <div className="load-error" role="alert">
            {error || knobError}
            <button onClick={onRetry}>Retry</button>
          </div>
        ) : null}
        <Button
          className="download-button"
          disabled={!geometry || !knobGeometry || !!error || !!knobError}
          onClick={onOpenExport}
        >
          {(!geometry || !knobGeometry) && !error && !knobError ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <ArrowDownToLine size={18} />
          )}{' '}
          Export design <ArrowRight size={17} />
        </Button>
      </div>
    </aside>
  )
}
