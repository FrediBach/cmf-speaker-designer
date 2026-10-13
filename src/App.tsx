import { useEffect, useRef, useState, Suspense, lazy } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CircleHelp,
  Copy,
  ExternalLink,
  Layers3,
  LoaderCircle,
  MousePointer2,
  MoveUpRight,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import type { BufferGeometry } from 'three'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { PanelIcon } from '@/components/PanelIcon'
import { AppearanceSettings } from '@/components/AppearanceSettings'
import { HandleEditor } from '@/components/HandleEditor'
import { GrilleEditor } from '@/components/GrilleEditor'
import { HaloEditor } from '@/components/HaloEditor'
import { ColorPicker } from '@/components/ColorPicker'
import { KnobEditor } from '@/components/KnobEditor'
import { KnobIcon } from '@/components/KnobIcon'
import { PreviewLoadBoundary } from '@/components/PreviewLoadBoundary'
import { normalizeKnobSettings, KNOB_STYLES } from '@/lib/knob-settings'
import { useKnobGeometry } from '@/lib/use-knob-geometry'
import type { DesignExportTarget } from '@/lib/design-export'
import { normalizeHandleSettings } from '@/lib/handle-settings'
import { normalizeGrilleSettings } from '@/lib/grille-settings'
import { normalizeHaloSettings } from '@/lib/halo-settings'
import { usePanelGeometry } from '@/lib/use-panel-geometry'
import {
  STORAGE_KEY,
  colorName,
  readDesign,
  validateDesign,
  type Design,
} from '@/lib/design'
import { randomizeDesign } from '@/lib/random-design'
import { useDesignHistory } from '@/lib/use-design-history'
import {
  getPanelStyles,
  getPanelDimensions,
  loadPanelGeometry,
} from '@/lib/panels'

const SpeakerPreview = lazy(() =>
  import('@/components/SpeakerPreview').then((module) => ({
    default: module.SpeakerPreview,
  })),
)
const COMMUNITY_URL =
  'https://nothing.community/d/63517-3d-print-your-own-cmf-speaker'
const looks = [
  { name: 'The original', panelColor: '#f45427', knobColor: '#303538' },
  { name: 'Fresh perspective', panelColor: '#13b7b1', knobColor: '#eeeae1' },
  { name: 'Less is more', panelColor: '#eeeae1', knobColor: '#13b7b1' },
  { name: 'After hours', panelColor: '#303538', knobColor: '#f45427' },
]
const EDITOR_TABS = [
  { id: 'panel', label: 'Front panel' },
  { id: 'halo', label: 'Halo' },
  { id: 'grille', label: 'Grille' },
  { id: 'handle', label: 'Handle' },
  { id: 'knob', label: 'Knob' },
] as const

function App() {
  const guideTriggerRef = useRef<HTMLButtonElement>(null)
  const exportTriggerRef = useRef<HTMLButtonElement>(null)
  const {
    design,
    setDesign,
    undo,
    redo,
    canUndo,
    canRedo,
    beginTransaction,
    endTransaction,
  } = useDesignHistory(readDesign)
  const historyGesture = useRef<'pointer' | 'keyboard' | null>(null)
  const [editorTab, setEditorTab] = useState<
    'panel' | 'halo' | 'grille' | 'handle' | 'knob'
  >(() =>
    design.halo.mode === 'custom'
      ? 'halo'
      : design.grille.mode === 'custom'
        ? 'grille'
        : design.handle.mode === 'custom'
          ? 'handle'
          : 'panel',
  )
  const [view, setView] = useState<'perspective' | 'front'>('perspective')
  const [assembly, setAssembly] = useState<
    'assembled' | 'panel' | 'exploded' | 'knob'
  >('assembled')
  const [resetKey, setResetKey] = useState(0)
  const [guideOpen, setGuideOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportTarget, setExportTarget] = useState<DesignExportTarget>('both')
  const [source, setSource] = useState<{
    geometry: BufferGeometry
    model: Design['model']
    style: Design['style']
  } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const update = (patch: Partial<Design>) =>
    setDesign((current) => {
      const next = { ...current, ...patch }
      return {
        ...next,
        style:
          next.halo.mode === 'custom' || next.grille.mode === 'custom'
            ? 'custom'
            : next.style,
        handle: normalizeHandleSettings(next.model, next.handle),
        grille: normalizeGrilleSettings(next.grille),
        halo: normalizeHaloSettings(next.halo),
        knob: normalizeKnobSettings(next.knob),
      }
    })
  const styles = getPanelStyles(design.model)
  const currentStyle = styles.find((item) => item.id === design.style)!
  const customHalo = design.halo.mode === 'custom'
  const customGrille = design.grille.mode === 'custom'
  const sourceStyle = 'original'
  const grilleLabel = `${{ round: 'Round', hex: 'Hexagonal', slot: 'Slotted' }[design.grille.pattern]} grille`
  const haloLabel = design.model === 'm' ? 'Custom Halos' : 'Custom Halo'
  const panelLabel = customHalo
    ? `${haloLabel}${customGrille ? ` · ${grilleLabel}` : ''}`
    : customGrille
      ? grilleLabel
      : currentStyle.label
  const panelStyleSelected = (style: Design['style']) => design.style === style
  const {
    geometry,
    previewGeometry,
    error: generationError,
    generating,
  } = usePanelGeometry(source, design, retryKey)
  const {
    geometry: knobGeometry,
    previewGeometry: previewKnobGeometry,
    error: knobError,
    generating: knobGenerating,
  } = useKnobGeometry(design.knob, retryKey)
  const knobLabel =
    KNOB_STYLES.find((item) => item.id === design.knob.style)?.label ??
    'Volume knob'
  const knobBounds = previewKnobGeometry?.boundingBox
  const knobDimensions = knobBounds
    ? `Ø${Number(Math.max(knobBounds.max.x - knobBounds.min.x, knobBounds.max.y - knobBounds.min.y).toFixed(2))} × ${Number((knobBounds.max.z - knobBounds.min.z).toFixed(2))}`
    : null
  const dimensions = previewGeometry
    ? getPanelDimensions(previewGeometry)
    : null
  const panelWidth = dimensions ? Math.round(dimensions.width) : 85
  const panelHeight = dimensions
    ? Math.round(dimensions.height)
    : design.model === 's'
      ? 131
      : 225
  const error = loadError || generationError

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(design))
    } catch {
      /* Editing still works when local storage is disabled. */
    }
    const url = new URL(window.location.href)
    if (url.searchParams.has('design')) {
      url.searchParams.set('design', JSON.stringify(design))
      window.history.replaceState(null, '', url)
    }
  }, [design])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoadError('')
    loadPanelGeometry(design.model, sourceStyle, controller.signal)
      .then((loaded) => {
        if (!active) {
          loaded.dispose()
          return
        }
        setSource({
          geometry: loaded,
          model: design.model,
          style: sourceStyle,
        })
      })
      .catch(() => {
        if (active) setLoadError('The panel could not load. Please try again.')
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [design.model, sourceStyle, retryKey])

  useEffect(
    () => () => {
      source?.geometry.dispose()
    },
    [source],
  )
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 4500)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const finishGesture = () => {
      if (!historyGesture.current) return
      historyGesture.current = null
      endTransaction()
    }
    const finishPointer = () => {
      if (historyGesture.current === 'pointer') finishGesture()
    }
    const finishKey = (event: KeyboardEvent) => {
      if (
        historyGesture.current === 'keyboard' &&
        /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key)
      )
        finishGesture()
    }
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            (target instanceof HTMLInputElement &&
              !['checkbox', 'radio', 'range', 'color'].includes(target.type)) ||
            target.closest(
              'textarea, select, [role="textbox"], [role="dialog"], [role="alertdialog"]',
            )))
      )
        return
      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo =
        (key === 'z' && event.shiftKey) ||
        (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey)
      if (!isUndo && !isRedo) return
      event.preventDefault()
      finishGesture()
      if (isUndo && canUndo) {
        undo()
        setToast('Design change undone.')
      } else if (isRedo && canRedo) {
        redo()
        setToast('Design change redone.')
      }
    }
    window.addEventListener('keydown', handleShortcut)
    window.addEventListener('keyup', finishKey)
    window.addEventListener('pointerup', finishPointer)
    window.addEventListener('pointercancel', finishPointer)
    window.addEventListener('blur', finishGesture)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
      window.removeEventListener('keyup', finishKey)
      window.removeEventListener('pointerup', finishPointer)
      window.removeEventListener('pointercancel', finishPointer)
      window.removeEventListener('blur', finishGesture)
    }
  }, [canUndo, canRedo, undo, redo, endTransaction])

  async function shareDesign() {
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('design', JSON.stringify(design))
    try {
      await navigator.clipboard.writeText(url.toString())
      setToast('Design link copied.')
    } catch {
      setToast('Link ready in your address bar. Copy it to share your design.')
      window.history.replaceState(null, '', url)
    }
  }

  async function exportDesign() {
    if (!geometry || !knobGeometry || busy) return
    setBusy(true)
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      )
      const { downloadDesignExport } = await import('@/lib/design-export')
      downloadDesignExport({
        panel: geometry,
        knob: knobGeometry,
        design,
        target: exportTarget,
      })
      setExportOpen(false)
      setToast(
        exportTarget === 'both'
          ? 'Panel, knob, and design settings downloaded.'
          : 'STL downloaded.',
      )
    } catch {
      setToast('The download could not start. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function resetDesign() {
    endTransaction()
    setDesign(validateDesign({ model: design.model }))
    setEditorTab('panel')
    setView('perspective')
    setAssembly('assembled')
    setResetKey((value) => value + 1)
    setToast('Design reset.')
  }

  function shuffleDesign() {
    endTransaction()
    setDesign(randomizeDesign(design.model))
    setAssembly('assembled')
    setToast('Design randomized. Undo with ⌘/Ctrl+Z.')
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#design-controls">
        Skip to design controls
      </a>
      <header className="site-header">
        <a className="brand" href="#" aria-label="CMF Speaker designer home">
          <h1 className="brand-title" id="page-title">
            <span className="brand-product">CMF Speaker</span>{' '}
            <span className="brand-divider" aria-hidden="true" />
            <span className="brand-descriptor">designer</span>
          </h1>
        </a>
        <span className="workspace-id" aria-hidden="true">
          CMF-SD / 001
        </span>
        <nav aria-label="Main navigation">
          <AppearanceSettings />
          <button
            className="guide-trigger"
            aria-label="Print guide"
            title="Print guide"
            onClick={(event) => {
              guideTriggerRef.current = event.currentTarget
              setGuideOpen(true)
            }}
          >
            <CircleHelp size={18} aria-hidden="true" />
            <span className="guide-trigger-label">Print guide</span>
          </button>
          <a href={COMMUNITY_URL} target="_blank" rel="noreferrer">
            Source files <ArrowUpRight size={16} />
          </a>
        </nav>
      </header>

      <main aria-labelledby="page-title">
        <section
          id="designer"
          className="designer"
          aria-label="Speaker front panel designer"
        >
          <div className="preview-column">
            <div className="preview-card">
              <div className="preview-topbar">
                <span className="eyebrow">
                  <span className="live-dot" /> PREVIEW
                </span>
                <div
                  className="view-switch"
                  role="group"
                  aria-label="Camera view"
                >
                  <button
                    className={view === 'perspective' ? 'active' : ''}
                    aria-pressed={view === 'perspective'}
                    onClick={() => setView('perspective')}
                  >
                    <Box size={14} /> 3D view
                  </button>
                  <button
                    className={view === 'front' ? 'active' : ''}
                    aria-pressed={view === 'front'}
                    onClick={() => setView('front')}
                  >
                    Front
                  </button>
                </div>
              </div>
              <div className="preview-watermark" aria-hidden="true">
                {design.model.toUpperCase()}-01
              </div>
              <div className="preview-stage">
                <PreviewLoadBoundary>
                  <Suspense
                    fallback={
                      <div className="preview-loading" role="status">
                        <LoaderCircle className="spin" size={22} />
                        <span>Loading preview…</span>
                      </div>
                    }
                  >
                    <SpeakerPreview
                      geometry={previewGeometry}
                      error={error}
                      key={retryKey}
                      model={design.model}
                      style={sourceStyle}
                      panelColor={design.panelColor}
                      knobColor={design.knobColor}
                      knobGeometry={previewKnobGeometry}
                      knobStyle={design.knob.style}
                      relief={design.relief}
                      view={view}
                      assembly={assembly}
                      resetKey={resetKey}
                    />
                  </Suspense>
                </PreviewLoadBoundary>
              </div>
              {(generating || knobGenerating) && previewGeometry && (
                <div className="geometry-updating" role="status">
                  <LoaderCircle className="spin" size={12} /> Updating geometry…
                </div>
              )}
              <div className="preview-bottom">
                <div>
                  <span className="preview-model">
                    CMF Speaker {design.model.toUpperCase()}
                    <span> / </span>
                    {assembly === 'knob' ? `${knobLabel} knob` : panelLabel}
                  </span>
                  <span className="preview-dimensions">
                    {assembly === 'knob'
                      ? knobDimensions
                        ? `${knobDimensions} MM`
                        : 'ORIGINAL FIT'
                      : `${panelWidth} × ${panelHeight} MM`}{' '}
                    <span>·</span>{' '}
                    {colorName(
                      assembly === 'knob'
                        ? design.knobColor
                        : design.panelColor,
                    ).toUpperCase()}
                  </span>
                </div>
                <div className="preview-actions">
                  <button
                    title="Reset camera"
                    aria-label="Reset camera"
                    onClick={() => setResetKey((value) => value + 1)}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    title="Share design"
                    aria-label="Copy design link"
                    onClick={shareDesign}
                  >
                    <Copy size={16} />
                  </button>
                </div>
              </div>
              <div className="preview-toolbar">
                <div
                  className="assembly-switch"
                  role="group"
                  aria-label="Preview mode"
                >
                  {(
                    [
                      { id: 'assembled', label: 'Speaker', icon: Box },
                      { id: 'panel', label: 'Panel only', icon: Layers3 },
                      { id: 'exploded', label: 'Exploded', icon: MoveUpRight },
                      {
                        id: 'knob',
                        label: 'Knob only',
                        icon: SlidersHorizontal,
                      },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      className={assembly === item.id ? 'active' : ''}
                      aria-pressed={assembly === item.id}
                      onClick={() => setAssembly(item.id)}
                    >
                      <item.icon size={14} />
                      {item.label}
                    </button>
                  ))}
                </div>
                <span className="orbit-hint">
                  <MousePointer2 size={13} /> Drag to rotate · Pinch or scroll
                  to zoom
                </span>
              </div>
            </div>
          </div>

          <aside
            className="controls"
            id="design-controls"
            aria-label="Design controls"
            aria-description="Undo with Command or Control plus Z. Redo with Command or Control plus Shift plus Z, or Control plus Y."
            tabIndex={-1}
            onPointerDownCapture={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest('[data-slot="slider"]')
              ) {
                // Commit a numeric draft before starting the slider's undo step.
                if (document.activeElement instanceof HTMLInputElement)
                  document.activeElement.blur()
                endTransaction()
                beginTransaction()
                historyGesture.current = 'pointer'
              }
            }}
            onKeyDownCapture={(event) => {
              if (
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                event.target instanceof Element &&
                event.target.closest('[role="slider"]') &&
                /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(
                  event.key,
                ) &&
                historyGesture.current !== 'keyboard'
              ) {
                endTransaction()
                beginTransaction()
                historyGesture.current = 'keyboard'
              }
            }}
            onFocusCapture={(event) => {
              if (
                event.target instanceof HTMLInputElement &&
                ['number', 'text', 'color'].includes(event.target.type)
              )
                beginTransaction()
            }}
            onBlur={(event) => {
              if (
                event.target instanceof HTMLInputElement &&
                historyGesture.current !== 'pointer'
              )
                endTransaction()
            }}
          >
            <div className="controls-heading">
              <div className="controls-heading-title">
                <SlidersHorizontal size={17} />
                <h2>Design controls</h2>
              </div>
              <div className="design-actions">
                <button
                  className="text-button"
                  onClick={shuffleDesign}
                  title="Randomize all settings for the selected speaker. Undo with ⌘/Ctrl+Z."
                >
                  <Shuffle size={12} aria-hidden="true" /> Randomize
                </button>
                <button
                  className="text-button"
                  onClick={resetDesign}
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
            </section>
            <div
              className="editor-tabs"
              role="tablist"
              aria-label="Design area"
            >
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
                      ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                        event.key,
                      )
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
                      onClick={(event) => {
                        guideTriggerRef.current = event.currentTarget
                        setGuideOpen(true)
                      }}
                    >
                      <CircleHelp size={14} />
                    </button>
                  </h3>
                  <div className="control-label">
                    <span id="relief-label">Added face depth</span>
                    <span className="value-chip">
                      {design.relief.toFixed(1)} mm
                    </span>
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
                  <Box size={13} /> STL FORMAT
                </span>
                <span>1:1 SCALE · MM</span>
              </div>
              {error || knobError ? (
                <div className="load-error" role="alert">
                  {error || knobError}
                  <button onClick={() => setRetryKey((key) => key + 1)}>
                    Retry
                  </button>
                </div>
              ) : null}
              <Button
                className="download-button"
                disabled={!geometry || !knobGeometry || !!error || !!knobError}
                onClick={(event) => {
                  exportTriggerRef.current = event.currentTarget
                  setExportOpen(true)
                }}
              >
                {(!geometry || !knobGeometry) && !error && !knobError ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <ArrowDownToLine size={18} />
                )}{' '}
                Export STL <ArrowRight size={17} />
              </Button>
            </div>
          </aside>
        </section>
      </main>
      <footer className="status-bar">
        <span>
          <span className="orange-dot" /> LOCAL WORKSPACE
        </span>
        <p>
          Independent project · Not affiliated with Nothing or CMF · (c) 2026{' '}
          <a href="https://fredibach.com" target="_blank" rel="noreferrer">
            Fredi Bach
          </a>
        </p>
        <a href={COMMUNITY_URL} target="_blank" rel="noreferrer">
          Files & credits <ExternalLink size={14} />
        </a>
      </footer>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            guideTriggerRef.current?.focus()
          }}
        >
          <div className="dialog-icon">
            <Layers3 size={23} />
          </div>
          <span className="eyebrow">REFERENCE / 01</span>
          <DialogTitle>Print guide</DialogTitle>
          <DialogDescription>
            Export your panel and knob, prepare them in a slicer, and check the
            first print.
          </DialogDescription>
          <ol className="print-steps">
            <li>
              <span>01</span>
              <div>
                <h4>Configure the panel</h4>
                <p>
                  Choose Speaker S or M and a panel shape. Added face depth
                  thickens the front while retaining the original mounting
                  features and folded controls. In the Halo tab, adjust the ring
                  profile and base rim, or tilt its front cut into a hood.
                  Combine it with your own opening pattern in the Grille tab. In
                  the Handle tab, generate a new upper extension and openings.
                  In the Knob tab, shape the upper grip while retaining the
                  original base and socket dimensions.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h4>Choose your filament</h4>
                <p>
                  PLA is a good starting point. PETG is another option for
                  frequently handled parts. The STL contains geometry; set
                  colors by choosing filament.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h4>Slice at 100% scale</h4>
                <p>
                  Unzip a full design download to find separate panel and knob
                  STLs and your saved colors and settings. Import the STLs in
                  millimeters; each part is placed on the build plate. Review
                  overhangs and supports in your slicer before printing.
                </p>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <h4>Test the first print</h4>
                <p>
                  Printer tolerances vary. Test the fit before making a full
                  set. Generated handles and custom face depth have not been
                  physically tested. Test strength before using a printed handle
                  to carry a speaker.
                </p>
              </div>
            </li>
          </ol>
          <a
            className="guide-source"
            href={COMMUNITY_URL}
            target="_blank"
            rel="noreferrer"
          >
            Read CMF’s original printing guide <ArrowUpRight size={15} />
          </a>
        </DialogContent>
      </Dialog>

      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          if (!busy) setExportOpen(open)
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            exportTriggerRef.current?.focus()
          }}
        >
          <div className="dialog-icon">
            <ArrowDownToLine size={23} />
          </div>
          <span className="eyebrow">EXPORT / STL</span>
          <DialogTitle>Export design</DialogTitle>
          <DialogDescription>
            Full-size parts in millimeters. Open each STL in your slicer at 100%
            scale.
          </DialogDescription>
          <div
            className="handle-mode export-targets"
            role="group"
            aria-label="Export parts"
          >
            {(
              [
                { id: 'both', label: 'Panel + knob' },
                { id: 'panel', label: 'Panel only' },
                { id: 'knob', label: 'Knob only' },
              ] as const
            ).map((target) => (
              <button
                key={target.id}
                aria-pressed={exportTarget === target.id}
                className={exportTarget === target.id ? 'active' : ''}
                onClick={() => setExportTarget(target.id)}
              >
                {target.label}
              </button>
            ))}
          </div>
          {exportTarget !== 'knob' && (
            <div className="download-summary">
              <PanelIcon model={design.model} style={design.style} />
              <div>
                <strong>
                  Speaker {design.model.toUpperCase()} · {panelLabel}
                </strong>
                <span>
                  {design.relief > 0
                    ? `${design.relief.toFixed(1)} mm added face depth`
                    : 'Standard face depth'}{' '}
                  · Binary STL
                </span>
                {design.handle.mode === 'custom' && (
                  <span>
                    Custom handle · {design.handle.height} mm extension ·{' '}
                    {design.handle.cutout === 'none'
                      ? 'Solid'
                      : `${design.handle.holeCount} ${design.handle.cutout === 'circle' ? 'round' : 'slot'} ${design.handle.holeCount === 1 ? 'hole' : 'holes'}`}
                  </span>
                )}
                {design.grille.mode === 'custom' && (
                  <span>
                    Custom grille · {design.grille.size} mm openings ·{' '}
                    {design.grille.spacing} mm spacing ·{' '}
                    {design.grille.thickness} mm thick
                    {design.grille.extendPattern
                      ? ` · ${design.grille.recessDepth} mm recessed face pattern`
                      : ''}
                  </span>
                )}
                {customHalo && (
                  <span>
                    {haloLabel} · {design.halo.depth} mm depth ·{' '}
                    {design.halo.thickness} mm wall · {design.halo.outwardAngle}
                    ° outward · {design.halo.cutAngle}° cut ·{' '}
                    {design.halo.cutRotation}° rotation ·{' '}
                    {design.halo.rimHeight === 0
                      ? 'Flush rim'
                      : `${design.halo.rimHeight} mm rim`}
                  </span>
                )}
                <span>
                  {panelWidth} × {panelHeight} mm · Millimeter units
                </span>
              </div>
              <span
                className="summary-swatch"
                style={{ background: design.panelColor }}
              />
            </div>
          )}
          {exportTarget !== 'panel' && (
            <div className="download-summary knob-download-summary">
              <KnobIcon style={design.knob.style} />
              <div>
                <strong>{knobLabel} volume knob</strong>
                <span>
                  {knobDimensions ? `${knobDimensions} mm · ` : ''}Binary STL
                </span>
                <span>{colorName(design.knobColor)} · Fits Speaker S & M</span>
              </div>
              <span
                className="summary-swatch"
                style={{ background: design.knobColor }}
              />
            </div>
          )}
          <div className="download-notes">
            <p>
              <Check size={15} /> Original mounting features retained
            </p>
            <p>
              <Check size={15} /> Separate parts, positioned on the build plate
            </p>
            {exportTarget === 'both' && (
              <p>
                <Check size={15} /> ZIP includes both STLs and design.json with
                your colors and settings
              </p>
            )}
          </div>
          <p className="export-caveat">
            STL files don’t store colors. Match your selected colors with
            filament. Review supports in your slicer and test-fit your first
            print.
          </p>
          <Button
            className="confirm-download"
            onClick={exportDesign}
            disabled={busy || !geometry || !knobGeometry}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <ArrowDownToLine size={17} />
            )}{' '}
            {busy
              ? 'Preparing files…'
              : exportTarget === 'both'
                ? 'Download ZIP'
                : 'Download STL'}
            <span>Speaker {design.model.toUpperCase()}</span>
          </Button>
        </DialogContent>
      </Dialog>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button
            onClick={() => setToast('')}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

export default App
