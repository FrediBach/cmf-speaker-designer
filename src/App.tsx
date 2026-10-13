import { useEffect, useState, Suspense, lazy } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  CirclePlus,
  Copy,
  ExternalLink,
  Layers3,
  LoaderCircle,
  MousePointer2,
  MoveUpRight,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
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
import { HandleEditor } from '@/components/HandleEditor'
import { normalizeHandleSettings } from '@/lib/handle-settings'
import { usePanelGeometry } from '@/lib/use-panel-geometry'
import {
  DEFAULT_DESIGN,
  PALETTE,
  STORAGE_KEY,
  colorName,
  readDesign,
  type Design,
} from '@/lib/design'
import {
  downloadPanelStl,
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

function ColorPicker({
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
        <label>{label}</label>
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
                  color.value === '#eeeae1' || color.value === '#e4b8b4'
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

function App() {
  const [design, setDesign] = useState<Design>(readDesign)
  const [editorTab, setEditorTab] = useState<'panel' | 'handle'>(() =>
    design.handle.mode === 'custom' ? 'handle' : 'panel',
  )
  const [view, setView] = useState<'perspective' | 'front'>('perspective')
  const [assembly, setAssembly] = useState<'assembled' | 'panel' | 'exploded'>(
    'assembled',
  )
  const [resetKey, setResetKey] = useState(0)
  const [guideOpen, setGuideOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
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
      return patch.model
        ? { ...next, handle: normalizeHandleSettings(next.model, next.handle) }
        : next
    })
  const styles = getPanelStyles(design.model)
  const currentStyle = styles.find((item) => item.id === design.style)!
  const {
    geometry,
    previewGeometry,
    error: generationError,
    generating,
  } = usePanelGeometry(source, design, retryKey)
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
    loadPanelGeometry(design.model, design.style, controller.signal)
      .then((loaded) => {
        if (!active) {
          loaded.dispose()
          return
        }
        setSource({
          geometry: loaded,
          model: design.model,
          style: design.style,
        })
      })
      .catch(() => {
        if (active) setLoadError('The panel could not load. Please try again.')
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [design.model, design.style, retryKey])

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

  async function shareDesign() {
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('design', JSON.stringify(design))
    try {
      await navigator.clipboard.writeText(url.toString())
      setToast('Design link copied. Make someone’s day.')
    } catch {
      setToast('Link ready in your address bar. Copy it to share your design.')
      window.history.replaceState(null, '', url)
    }
  }

  async function exportPanel() {
    if (!geometry || busy) return
    setBusy(true)
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      )
      downloadPanelStl(geometry, design.model, design.style, design.relief)
      setExportOpen(false)
      setToast('Your STL is downloaded. Time to make it real.')
    } catch {
      setToast('The download could not start. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function resetDesign() {
    setDesign({ ...DEFAULT_DESIGN })
    setView('perspective')
    setAssembly('assembled')
    setResetKey((value) => value + 1)
    setToast('Back to the original. A fresh start.')
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#" aria-label="CMF Speaker Designer home">
          <span className="brand-word">
            cmf<span className="brand-dot">●</span>
          </span>
          <span className="brand-divider" />
          <span className="brand-title">
            SPEAKER
            <br />
            DESIGNER
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#designer" className="nav-active">
            The designer
          </a>
          <button onClick={() => setGuideOpen(true)}>
            Print guide <ArrowUpRight size={14} />
          </button>
        </nav>
        <a
          className="community-link"
          href={COMMUNITY_URL}
          target="_blank"
          rel="noreferrer"
        >
          Built for the community <ArrowUpRight size={15} />
        </a>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div>
            <div className="eyebrow">
              <span className="orange-dot" /> A LITTLE DIFFERENT. A LOT MORE
              YOU.
            </div>
            <h1 id="page-title">
              Make it yours<span>.</span>
            </h1>
          </div>
          <div className="intro-note">
            <p>Your speaker. Your colors. Your kind of loud.</p>
            <p>Design a front panel, preview it in 3D, and print it.</p>
            <span className="beta-tag">
              THE COMMUNITY DESIGN LAB <span>V.01</span>
            </span>
          </div>
        </section>

        <section
          id="designer"
          className="designer"
          aria-label="Speaker front panel designer"
        >
          <div className="preview-column">
            <div className="preview-card">
              <div className="preview-topbar">
                <span className="eyebrow">
                  <span className="live-dot" /> LIVE PREVIEW
                </span>
                <div className="view-switch" aria-label="Camera view">
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
                SPEAKER {design.model.toUpperCase()}
              </div>
              <div className="preview-stage">
                <Suspense
                  fallback={
                    <div className="preview-loading">
                      <LoaderCircle className="spin" size={22} />
                      <span>Getting your speaker ready</span>
                    </div>
                  }
                >
                  <SpeakerPreview
                    geometry={previewGeometry}
                    error={error}
                    key={retryKey}
                    model={design.model}
                    style={design.style}
                    panelColor={design.panelColor}
                    knobColor={design.knobColor}
                    relief={design.relief}
                    view={view}
                    assembly={assembly}
                    resetKey={resetKey}
                  />
                </Suspense>
              </div>
              {generating && previewGeometry && (
                <div className="geometry-updating" role="status">
                  <LoaderCircle className="spin" size={12} /> Updating geometry…
                </div>
              )}
              <div className="preview-side-label">DESIGNED TO BE DIFFERENT</div>
              <div className="preview-bottom">
                <div>
                  <span className="preview-model">
                    CMF Speaker {design.model.toUpperCase()}
                    <span> / </span>
                    {currentStyle.label}
                  </span>
                  <span className="preview-dimensions">
                    {panelWidth} × {panelHeight} MM <span>·</span>{' '}
                    {colorName(design.panelColor).toUpperCase()}
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
                <div className="assembly-switch" aria-label="Preview mode">
                  {(
                    [
                      { id: 'assembled', label: 'Speaker', icon: Box },
                      { id: 'panel', label: 'Panel only', icon: Layers3 },
                      { id: 'exploded', label: 'Exploded', icon: MoveUpRight },
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
                  <MousePointer2 size={13} /> Drag to rotate · Scroll to zoom
                </span>
              </div>
            </div>
            <div className="looks-bar">
              <div className="looks-title">
                <Sparkles size={15} />
                <span>A little inspiration</span>
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
            <div className="workspace-note">
              <span>
                <span className="tiny-cross">+</span> Real CMF geometry. Endless
                personality.
              </span>
              <button onClick={() => setGuideOpen(true)}>
                New to 3D printing? <ArrowRight size={14} />
              </button>
            </div>
          </div>

          <aside className="controls" aria-label="Design controls">
            <div className="controls-heading">
              <div>
                <SlidersHorizontal size={17} />
                <h2>Your design</h2>
              </div>
              <button className="text-button" onClick={resetDesign}>
                <RotateCcw size={12} /> Reset
              </button>
            </div>
            <section className="control-section">
              <h3>
                <span>01</span> Choose your speaker
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
                        {model === 's'
                          ? 'Small. Full of character.'
                          : 'More room to play.'}
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
              {(['panel', 'handle'] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-label={tab === 'panel' ? 'Front panel' : 'Handle'}
                  id={`${tab}-tab`}
                  aria-controls={`${tab}-editor`}
                  aria-selected={editorTab === tab}
                  tabIndex={editorTab === tab ? 0 : -1}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'ArrowLeft' ||
                      event.key === 'ArrowRight'
                    ) {
                      const next = tab === 'panel' ? 'handle' : 'panel'
                      setEditorTab(next)
                      document.getElementById(`${next}-tab`)?.focus()
                    }
                  }}
                  onClick={() => setEditorTab(tab)}
                >
                  {tab === 'panel' ? 'Front panel' : 'Handle'}
                  {tab === 'handle' && <span>NEW</span>}
                </button>
              ))}
            </div>
            <div
              id="panel-editor"
              role="tabpanel"
              aria-labelledby="panel-tab"
              hidden={editorTab !== 'panel'}
            >
              <section className="control-section">
                <h3>
                  <span>02</span> Find your shape
                </h3>
                <div className="style-options">
                  {styles.map((style) => (
                    <button
                      key={style.id}
                      className={`style-option ${design.style === style.id ? 'selected' : ''}`}
                      onClick={() => update({ style: style.id })}
                      aria-pressed={design.style === style.id}
                    >
                      <PanelIcon model={design.model} style={style.id} />
                      <span>{style.label}</span>
                      {design.style === style.id && (
                        <Check className="style-check" size={12} />
                      )}
                    </button>
                  ))}
                </div>
                <p className="style-description">{currentStyle.description}</p>
              </section>
              <section className="control-section">
                <h3>
                  <span>03</span> Add your color
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
                  Color is a preview. Make it real with your filament.
                </p>
              </section>
              <section className="control-section relief-section">
                <h3>
                  <span>04</span> Fine-tune the face{' '}
                  <button
                    className="help-button"
                    aria-label="About added face depth"
                    onClick={() => setGuideOpen(true)}
                  >
                    <CircleHelp size={14} />
                  </button>
                </h3>
                <div className="control-label">
                  <label id="relief-label">Added face depth</label>
                  <span className="value-chip">
                    {design.relief.toFixed(1)} mm
                  </span>
                </div>
                <Slider
                  aria-labelledby="relief-label"
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
            <div className="export-section">
              <div className="export-spec">
                <span>
                  <Box size={13} /> STL FORMAT
                </span>
                <span>1:1 SCALE · MM</span>
              </div>
              {error ? (
                <div className="load-error" role="alert">
                  {error}
                  <button onClick={() => setRetryKey((key) => key + 1)}>
                    Retry
                  </button>
                </div>
              ) : null}
              <Button
                className="download-button"
                disabled={!geometry || !!error}
                onClick={() => setExportOpen(true)}
              >
                {!geometry && !error ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <ArrowDownToLine size={18} />
                )}{' '}
                Download your panel <ArrowRight size={17} />
              </Button>
              <p>Made by you. Ready for your slicer.</p>
            </div>
          </aside>
        </section>

        <section className="make-section" aria-labelledby="make-title">
          <div className="make-copy">
            <span className="eyebrow">LESS OFF-THE-SHELF. MORE OFF-BEAT.</span>
            <h2 id="make-title">
              Good design leaves
              <br />
              room for you.
            </h2>
            <p>
              A speaker you can take apart. A front panel you can make your own.
              Start with CMF’s original files and put a little of yourself into
              the everyday.
            </p>
            <a href={COMMUNITY_URL} target="_blank" rel="noreferrer">
              Meet the open design project <ArrowUpRight size={16} />
            </a>
            <div className="make-steps">
              <span>
                <b>01</b> Design it
              </span>
              <ChevronRight size={14} />
              <span>
                <b>02</b> Print it
              </span>
              <ChevronRight size={14} />
              <span>
                <b>03</b> Play it
              </span>
            </div>
          </div>
          <div className="make-image">
            <img
              src="/speakers-lineup.png"
              alt="Orange, white, graphite, and teal CMF speakers with interchangeable front panels and contrasting volume knobs"
              loading="lazy"
            />
            <span>ONE SPEAKER. YOUR EXPRESSION.</span>
          </div>
        </section>
      </main>
      <footer>
        <a className="footer-brand" href="#">
          cmf<span>●</span> <span>speaker designer</span>
        </a>
        <p>
          An independent community project. Not affiliated with Nothing or CMF.
        </p>
        <a href={COMMUNITY_URL} target="_blank" rel="noreferrer">
          Original files & credits <ExternalLink size={12} />
        </a>
      </footer>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent>
          <div className="dialog-icon">
            <Layers3 size={23} />
          </div>
          <span className="eyebrow">FROM PIXELS TO PLASTIC</span>
          <DialogTitle>Your first print starts here.</DialogTitle>
          <DialogDescription>
            A few practical pointers for turning your design into a real CMF
            front panel.
          </DialogDescription>
          <ol className="print-steps">
            <li>
              <span>01</span>
              <div>
                <h4>Make it your own</h4>
                <p>
                  Choose Speaker S or M and a panel shape. Added face depth
                  thickens the front while retaining the original mounting
                  features and folded controls. In the Handle tab, generate a
                  new upper extension with your own outline and openings.
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
                  Import your STL in millimeters. The export is laid
                  horizontally and placed on the build plate. Review overhangs
                  and supports in your slicer before printing.
                </p>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <h4>Print one. Check the fit.</h4>
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
        <DialogContent>
          <div className="dialog-icon">
            <ArrowDownToLine size={23} />
          </div>
          <span className="eyebrow">MAKE SOMETHING THAT’S YOURS</span>
          <DialogTitle>Meet your next print.</DialogTitle>
          <DialogDescription>
            Your front panel, in full size and ready to open in your favorite
            slicer.
          </DialogDescription>
          <div className="download-summary">
            <PanelIcon model={design.model} style={design.style} />
            <div>
              <strong>
                Speaker {design.model.toUpperCase()} · {currentStyle.label}
              </strong>
              <span>
                {design.relief > 0
                  ? `${design.relief.toFixed(1)} mm added face depth`
                  : 'Original surface'}{' '}
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
              <span>
                {panelWidth} × {panelHeight} mm · Millimeter units
              </span>
            </div>
            <span
              className="summary-swatch"
              style={{ background: design.panelColor }}
            />
          </div>
          <div className="download-notes">
            <p>
              <Check size={15} /> Full-size panel with original mounting
              features
            </p>
            <p>
              <Check size={15} /> Horizontal layout, positioned on the build
              plate
            </p>
            <p>
              <CircleHelp size={15} /> Panel only. Knob and speaker body are
              preview objects.
            </p>
          </div>
          <p className="export-caveat">
            STL files don’t store colors. Use{' '}
            {colorName(design.panelColor).toLowerCase()} filament for this look.
            Review supports in your slicer and test-fit your first print
            {design.relief > 0
              ? ' — custom face depth has not been physically tested'
              : ''}
            .
          </p>
          <Button
            className="confirm-download"
            onClick={exportPanel}
            disabled={busy || !geometry}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <ArrowDownToLine size={17} />
            )}{' '}
            {busy ? 'Preparing STL…' : 'Download STL'}
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
    </>
  )
}

export default App
