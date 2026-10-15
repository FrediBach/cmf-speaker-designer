import { useRef, useState, type RefObject, type MouseEventHandler } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Box,
  ChevronUp,
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
import { BODY_COLORS, BODY_GRILLE_COLORS, type Design } from '@/lib/design'
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
  onBeginTransaction: () => void
  onEndTransaction: () => void
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
  onBeginTransaction,
  onEndTransaction,
}: Props) {
  const [speakerCollapsed, setSpeakerCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const speakerControlsRef = useRef<HTMLDivElement>(null)
  const selectedModelRef = useRef<HTMLButtonElement>(null)
  const revealingScrollRef = useRef<HTMLDivElement | null>(null)

  function finishRevealScroll() {
    revealingScrollRef.current = null
  }

  function revealSpeakerControls() {
    const scroller = scrollRef.current
    revealingScrollRef.current =
      scroller && scroller.scrollTop > 0 ? scroller : null
    setSpeakerCollapsed(false)
    scroller?.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    })
    requestAnimationFrame(() =>
      selectedModelRef.current?.focus({ preventScroll: true }),
    )
  }

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
      <SpeakerSettings
        design={design}
        update={update}
        speakerCollapsed={speakerCollapsed}
        revealSpeakerControls={revealSpeakerControls}
        speakerControlsRef={speakerControlsRef}
        selectedModelRef={selectedModelRef}
      />
      <EditorTabs
        editorTab={editorTab}
        setEditorTab={setEditorTab}
        assembly={assembly}
        setAssembly={setAssembly}
      />
      <div
        className="controls-scroll"
        ref={scrollRef}
        key={editorTab}
        onWheel={finishRevealScroll}
        onPointerDown={finishRevealScroll}
        onKeyDown={finishRevealScroll}
        onScrollEnd={finishRevealScroll}
        onScroll={(event) => {
          const scroller = event.currentTarget
          // Ignore the smooth return to the top while the full controls open.
          if (revealingScrollRef.current === scroller) {
            if (scroller.scrollTop <= 0) revealingScrollRef.current = null
            return
          }
          // Returning to the top reveals the controls without moving focus.
          // A resize can also clamp the position to zero when all content fits;
          // keep that case collapsed so the header cannot oscillate.
          if (
            speakerCollapsed &&
            scroller.scrollTop <= 0 &&
            scroller.scrollHeight > scroller.clientHeight
          ) {
            setSpeakerCollapsed(false)
          }
          if (!speakerCollapsed && scroller.scrollTop > 0) {
            if (speakerControlsRef.current?.contains(document.activeElement)) {
              scroller.focus({ preventScroll: true })
            }
            setSpeakerCollapsed(true)
          }
        }}
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
            geometry={meshes.previewGeometry}
            materialCount={meshes.materialParts?.length ?? null}
            patternNotes={meshes.multicolorDiagnostics}
            patternError={meshes.multicolorError}
            onBeginTransaction={onBeginTransaction}
            onEndTransaction={onEndTransaction}
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
      <ExportControls
        design={design}
        meshes={meshes}
        onRetry={onRetry}
        onOpenExport={onOpenExport}
      />
    </aside>
  )
}

function SpeakerSettings({
  design,
  update,
  speakerCollapsed,
  revealSpeakerControls,
  speakerControlsRef,
  selectedModelRef,
}: Pick<Props, 'design' | 'update'> & {
  speakerCollapsed: boolean
  revealSpeakerControls: () => void
  speakerControlsRef: RefObject<HTMLDivElement | null>
  selectedModelRef: RefObject<HTMLButtonElement | null>
}) {
  const speakerDimensions = design.model === 's' ? '85 × 131 mm' : '85 × 225 mm'
  const bodyLabel = BODY_COLORS[design.bodyColor].label
  const grilleLabel = BODY_GRILLE_COLORS[design.bodyGrilleColor].label

  return (
    <div className="speaker-settings" data-collapsed={speakerCollapsed}>
      <div
        className="speaker-summary-row"
        inert={!speakerCollapsed}
        aria-hidden={!speakerCollapsed}
      >
        <div className="speaker-settings-clip">
          <button
            type="button"
            className="speaker-summary"
            aria-label={`Edit speaker model and colors: Speaker ${design.model.toUpperCase()}, ${speakerDimensions}, ${bodyLabel} body, ${grilleLabel} grille`}
            aria-expanded={!speakerCollapsed}
            aria-controls="speaker-settings-controls"
            title="Edit speaker model and colors"
            onClick={revealSpeakerControls}
          >
            <PanelIcon model={design.model} />
            <span className="speaker-summary-metadata">
              <span className="speaker-summary-model">
                <strong>Speaker {design.model.toUpperCase()}</strong>
                <span>{speakerDimensions}</span>
              </span>
              <span className="speaker-summary-colors">
                <span>
                  <span
                    className="body-color-swatch"
                    style={{
                      background: BODY_COLORS[design.bodyColor].shell,
                    }}
                    aria-hidden="true"
                  />
                  {bodyLabel} body
                </span>
                <span>
                  <span
                    className="body-color-swatch"
                    style={{
                      background:
                        BODY_GRILLE_COLORS[design.bodyGrilleColor].value,
                    }}
                    aria-hidden="true"
                  />
                  {grilleLabel} grille
                </span>
              </span>
            </span>
            <ChevronUp size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        className="speaker-controls-row"
        id="speaker-settings-controls"
        ref={speakerControlsRef}
        inert={speakerCollapsed}
        aria-hidden={speakerCollapsed}
      >
        <div className="speaker-settings-clip">
          <section className="control-section model-section">
            <h3>
              <span>01</span> Speaker model
            </h3>
            <div className="model-options">
              {(['s', 'm'] as const).map((model) => (
                <button
                  key={model}
                  ref={design.model === model ? selectedModelRef : undefined}
                  aria-pressed={design.model === model}
                  className={`model-option ${design.model === model ? 'selected' : ''}`}
                  onClick={() => update({ model })}
                >
                  <PanelIcon model={model} />
                  <span>
                    Speaker {model.toUpperCase()}
                    <small>
                      {model === 's' ? '85 × 131 mm' : '85 × 225 mm'}
                    </small>
                  </span>
                  <span className="radio-indicator">
                    {design.model === model && <span />}
                  </span>
                </button>
              ))}
            </div>
            <div className="speaker-color-controls">
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
              <div className="body-color-control">
                <span id="body-grille-color-label">Speaker grille</span>
                <div
                  className="body-color-options body-grille-options"
                  role="group"
                  aria-labelledby="body-grille-color-label"
                  aria-describedby="body-grille-color-help"
                >
                  {(['black', 'orange', 'turquoise'] as const).map(
                    (bodyGrilleColor) => (
                      <button
                        key={bodyGrilleColor}
                        type="button"
                        aria-label={`Speaker grille: ${BODY_GRILLE_COLORS[bodyGrilleColor].label}`}
                        aria-pressed={
                          design.bodyGrilleColor === bodyGrilleColor
                        }
                        title={`${BODY_GRILLE_COLORS[bodyGrilleColor].label} grille`}
                        disabled={
                          design.bodyColor === 'gray' &&
                          bodyGrilleColor !== 'black'
                        }
                        onClick={() => update({ bodyGrilleColor })}
                      >
                        <span
                          className="body-color-swatch"
                          style={{
                            background:
                              BODY_GRILLE_COLORS[bodyGrilleColor].value,
                          }}
                          aria-hidden="true"
                        />
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
            <p className="body-grille-color-help" id="body-grille-color-help">
              {design.bodyColor === 'gray'
                ? 'Gray bodies come with a black grille.'
                : `${BODY_GRILLE_COLORS[design.bodyGrilleColor].label} grille selected.`}
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

function EditorTabs({
  editorTab,
  setEditorTab,
  assembly,
  setAssembly,
}: Pick<Props, 'editorTab' | 'setEditorTab' | 'assembly' | 'setAssembly'>) {
  function selectTab(tab: EditorTab) {
    setEditorTab(tab)
    if (tab === 'knob') setAssembly('knob')
    else if (assembly === 'knob') setAssembly('assembled')
  }

  return (
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
              selectTab(next)
              document.getElementById(`${next}-tab`)?.focus()
            }
          }}
          onClick={() => selectTab(tab)}
        >
          {tab === 'panel' ? 'Panel' : label}
        </button>
      ))}
    </div>
  )
}

function ExportControls({
  design,
  meshes,
  onRetry,
  onOpenExport,
}: Pick<Props, 'design' | 'meshes' | 'onRetry' | 'onOpenExport'>) {
  const {
    geometry,
    knobGeometry,
    powerButtonGeometry,
    error,
    knobError,
    powerButtonError,
    materialParts,
    multicolorError,
  } = meshes
  const colorsReady = !design.multicolor.enabled || !!materialParts
  const geometryReady = !!geometry && !!knobGeometry && !!powerButtonGeometry
  const geometryError = error || knobError || powerButtonError
  const exportError = geometryError || multicolorError
  return (
    <div className="export-section">
      <div className="export-spec">
        <span>
          <Box size={13} />{' '}
          {design.multicolor.enabled ? '3MF / STL / STP' : 'STL / STP / 3MF'}
        </span>
        <span>1:1 SCALE · MM</span>
      </div>
      {exportError ? (
        <div className="load-error" role="alert">
          {exportError}
          <button onClick={onRetry}>Retry</button>
        </div>
      ) : null}
      <Button
        className="download-button"
        disabled={!geometryReady || !!geometryError}
        onClick={onOpenExport}
      >
        {(!geometryReady || !colorsReady) && !exportError ? (
          <LoaderCircle size={17} className="spin" />
        ) : (
          <ArrowDownToLine size={18} />
        )}{' '}
        Export design <ArrowRight size={17} />
      </Button>
    </div>
  )
}
