import { useEffect, useRef, useState, type MouseEventHandler } from 'react'
import { ArrowUpRight, Check, CircleHelp, ExternalLink, X } from 'lucide-react'
import { AppearanceSettings } from '@/components/AppearanceSettings'
import { DesignerPreview } from '@/components/DesignerPreview'
import { DesignControls } from '@/components/DesignControls'
import { PrintGuide } from '@/components/PrintGuide'
import { ExportDialog } from '@/components/ExportDialog'
import { normalizeKnobSettings } from '@/lib/knob-settings'
import { normalizeHandleSettings } from '@/lib/handle-settings'
import { normalizeGrilleSettings } from '@/lib/grille-settings'
import { normalizeHaloSettings } from '@/lib/halo-settings'
import {
  STORAGE_KEY,
  readDesign,
  validateDesign,
  type Design,
} from '@/lib/design'
import { randomizeDesign } from '@/lib/random-design'
import { useDesignHistory } from '@/lib/use-design-history'
import { useDesignGeometry } from '@/lib/use-design-geometry'
import { useDesignInteractions } from '@/lib/use-design-interactions'
import { COMMUNITY_URL } from '@/lib/community'

function App() {
  const guideTriggerRef = useRef<HTMLButtonElement>(null)
  const exportTriggerRef = useRef<HTMLButtonElement>(null)
  const history = useDesignHistory(readDesign)
  const { design, setDesign, endTransaction } = history
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
  const meshes = useDesignGeometry(design, retryKey)
  const interactionHandlers = useDesignInteractions(history, setToast)

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
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 4500)
    return () => clearTimeout(timer)
  }, [toast])

  const openGuide: MouseEventHandler<HTMLButtonElement> = (event) => {
    guideTriggerRef.current = event.currentTarget
    setGuideOpen(true)
  }

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
            onClick={openGuide}
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
          <DesignerPreview
            design={design}
            meshes={meshes}
            view={view}
            assembly={assembly}
            setView={setView}
            setAssembly={setAssembly}
            resetKey={resetKey}
            retryKey={retryKey}
            onResetCamera={() => setResetKey((value) => value + 1)}
            onShare={shareDesign}
          />
          <DesignControls
            design={design}
            update={update}
            editorTab={editorTab}
            setEditorTab={setEditorTab}
            assembly={assembly}
            setAssembly={setAssembly}
            meshes={meshes}
            interactionHandlers={interactionHandlers}
            onOpenGuide={openGuide}
            onOpenExport={(event) => {
              exportTriggerRef.current = event.currentTarget
              setExportOpen(true)
            }}
            onReset={resetDesign}
            onRandomize={shuffleDesign}
            onRetry={() => setRetryKey((key) => key + 1)}
          />
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

      <PrintGuide
        open={guideOpen}
        onOpenChange={setGuideOpen}
        triggerRef={guideTriggerRef}
      />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        triggerRef={exportTriggerRef}
        design={design}
        meshes={meshes}
        onNotify={setToast}
      />
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
