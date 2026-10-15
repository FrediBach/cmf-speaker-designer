import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Focus,
  LoaderCircle,
  Maximize,
  Move,
  Rotate3d,
  Shuffle,
  Sparkles,
  X,
} from 'lucide-react'
import type { Design } from '@/lib/design'
import {
  createDesignVariations,
  panelSafeVariation,
  type DesignVariation,
} from '@/lib/design-variations'
import type { useDesignGeometry } from '@/lib/use-design-geometry'
import { PreviewLoadBoundary } from './PreviewLoadBoundary'
import type { VariationCameraMode } from './VariationExplorer'
import './variations.css'

const VariationExplorer = lazy(() =>
  import('./VariationExplorer').then((module) => ({
    default: module.VariationExplorer,
  })),
)

type CandidateStatus = 'loading' | 'ready' | 'error'

interface Props {
  design: Design
  initialVariations: DesignVariation[]
  meshes: ReturnType<typeof useDesignGeometry>
  onCancel: () => void
  onChoose: (design: Design) => void
}

/** Exploration owns drafts only. The parent receives a design on confirmation. */
export function VariationWorkspace({
  design,
  initialVariations,
  meshes,
  onCancel,
  onChoose,
}: Props) {
  const [variations, setVariations] = useState(initialVariations)
  const [selectedId, setSelectedId] = useState('original')
  const [statuses, setStatuses] = useState<Record<string, CandidateStatus>>({})
  const [generation, setGeneration] = useState(0)
  const [resetKey, setResetKey] = useState(0)
  const [focusKey, setFocusKey] = useState(0)
  const [cameraMode, setCameraMode] = useState<VariationCameraMode>('rotate')
  const [previewFailed, setPreviewFailed] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const retried = useRef(new Set<string>())
  const selected =
    variations.find((variation) => variation.id === selectedId) ?? variations[0]
  const ready = !previewFailed && statuses[selected.id] === 'ready'
  const readyCount = variations.filter(
    (variation) => statuses[variation.id] === 'ready',
  ).length
  const failedCount = Object.values(statuses).filter(
    (status) => status === 'error',
  ).length
  const building =
    readyCount + failedCount < variations.length && !previewFailed

  const onCandidateStatus = useCallback(
    (id: string, status: CandidateStatus) => {
      setStatuses((current) =>
        current[id] === status ? current : { ...current, [id]: status },
      )
    },
    [],
  )
  const onPreviewError = useCallback(() => setPreviewFailed(true), [])
  const onCandidateFallback = useCallback(
    (id: string) => {
      if (retried.current.has(id)) return false
      retried.current.add(id)
      setStatuses((current) => ({ ...current, [id]: 'loading' }))
      setVariations((current) =>
        current.map((variation) =>
          variation.id === id
            ? {
                ...variation,
                design: panelSafeVariation(design, variation.design),
                panelFallback: true,
              }
            : variation,
        ),
      )
      return true
    },
    [design],
  )

  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !(
          event.target instanceof Element &&
          event.target.closest('[role="dialog"], [role="alertdialog"]')
        )
      ) {
        event.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [onCancel])

  function regenerate() {
    retried.current.clear()
    setVariations(createDesignVariations(design))
    setSelectedId('original')
    setStatuses({})
    setPreviewFailed(false)
    setGeneration((value) => value + 1)
  }

  return (
    <section
      className="variation-workspace preview-column"
      aria-label="Variation explorer"
    >
      <div className="variation-heading">
        <div className="variation-title">
          <Sparkles size={18} aria-hidden="true" />
          <div>
            <h2>Explore variations</h2>
            <p>Small changes nearby. Bigger ideas further out.</p>
          </div>
        </div>
        <button
          ref={cancelRef}
          className="variation-button"
          onClick={onCancel}
          aria-label="Cancel variations"
        >
          <X size={16} aria-hidden="true" />
          <span>Cancel</span>
        </button>
      </div>
      <div className="variation-stage">
        <PreviewLoadBoundary key={generation} onError={onPreviewError}>
          <Suspense
            fallback={
              <div className="preview-loading" role="status">
                <LoaderCircle className="spin" size={22} />
                Loading variations…
              </div>
            }
          >
            <VariationExplorer
              variations={variations}
              selectedId={selectedId}
              onInspect={setSelectedId}
              onCandidateStatus={onCandidateStatus}
              onCandidateFallback={onCandidateFallback}
              resetKey={resetKey}
              focusKey={focusKey}
              cameraMode={cameraMode}
              originalMeshes={meshes}
              onError={onPreviewError}
            />
          </Suspense>
        </PreviewLoadBoundary>
        <div className="variation-legend" aria-hidden="true">
          <span>Original</span>
          <i />
          <span>Subtle</span>
          <i />
          <span>Explore</span>
          <i />
          <span>Bold</span>
        </div>
        <div className="variation-navigation">
          <div
            className="variation-camera-modes"
            role="group"
            aria-label="Camera movement"
          >
            <button
              className="variation-button"
              onClick={() => setCameraMode('rotate')}
              aria-label="Rotate camera"
              aria-pressed={cameraMode === 'rotate'}
              title="Drag to rotate the camera"
            >
              <Rotate3d size={16} aria-hidden="true" />
              <span>Rotate</span>
            </button>
            <button
              className="variation-button"
              onClick={() => setCameraMode('pan')}
              aria-label="Pan camera"
              aria-pressed={cameraMode === 'pan'}
              title="Drag to pan the camera"
            >
              <Move size={16} aria-hidden="true" />
              <span>Pan</span>
            </button>
          </div>
          <div className="variation-framing">
            <button
              className="variation-button"
              onClick={() => setResetKey((value) => value + 1)}
              aria-label="Fit all variations"
              title="Fit all variations"
            >
              <Maximize size={16} aria-hidden="true" />
              <span>Fit all</span>
            </button>
            <button
              className="variation-button"
              disabled={!ready}
              onClick={() => setFocusKey((value) => value + 1)}
              aria-label="Focus variation"
              title="Look closer at this variation"
            >
              <Focus size={16} aria-hidden="true" />
              <span>Look closer</span>
            </button>
          </div>
        </div>
      </div>
      <div className="variation-footer">
        <div className="variation-selection">
          <label htmlFor="inspect-variation">Inspect variation</label>
          <select
            id="inspect-variation"
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {variations.map((variation) => (
              <option
                key={variation.id}
                value={variation.id}
                disabled={statuses[variation.id] !== 'ready' || previewFailed}
              >
                {variation.label}
                {statuses[variation.id] === 'error'
                  ? ' · unavailable'
                  : statuses[variation.id] !== 'ready'
                    ? ' · building'
                    : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="variation-progress" role="status">
          <span>
            {building && (
              <LoaderCircle className="spin" size={12} aria-hidden="true" />
            )}
            {previewFailed
              ? 'Preview unavailable'
              : `${readyCount} / ${variations.length} ready`}
            {failedCount > 0 && ` · ${failedCount} unavailable`}
          </span>
          {selected.panelFallback && (
            <span>Original panel shape · varied colors and knob</span>
          )}
          <span>Your design stays unchanged until you choose.</span>
        </div>
        <div className="variation-footer-actions">
          <button className="variation-button" onClick={regenerate}>
            <Shuffle size={15} aria-hidden="true" />
            <span>New variations</span>
          </button>
          <button
            className="variation-button variation-choose"
            disabled={!ready}
            onClick={() => {
              if (!ready) return
              if (selected.id === 'original') onCancel()
              else onChoose(selected.design)
            }}
          >
            <Check size={16} aria-hidden="true" />
            {selected.id === 'original' ? 'Keep original' : 'Use variation'}
          </button>
        </div>
        <p className="variation-help">
          Drag to {cameraMode} · Scroll or pinch to zoom · Click a speaker to
          inspect · Esc to cancel
        </p>
      </div>
    </section>
  )
}
