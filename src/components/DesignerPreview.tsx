import { lazy, Suspense, useEffect, useRef } from 'react'
import {
  Box,
  Copy,
  FileDown,
  FolderOpen,
  Layers3,
  LoaderCircle,
  MousePointer2,
  MoveUpRight,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { VariationWorkspace } from './VariationWorkspace'
import { PreviewLoadBoundary } from './PreviewLoadBoundary'
import type { SpeakerPreviewProps } from './SpeakerPreview'
import { colorName, type Design } from '@/lib/design'
import type { DesignVariation } from '@/lib/design-variations'
import { getDesignSummary } from '@/lib/design-summary'
import type { useDesignGeometry } from '@/lib/use-design-geometry'

const SpeakerPreview = lazy(() =>
  import('@/components/SpeakerPreview').then((module) => ({
    default: module.SpeakerPreview,
  })),
)

interface Props {
  design: Design
  meshes: ReturnType<typeof useDesignGeometry>
  view: NonNullable<SpeakerPreviewProps['view']>
  presentation: boolean
  setPresentation: (presentation: boolean) => void
  assembly: NonNullable<SpeakerPreviewProps['assembly']>
  setView: (view: NonNullable<SpeakerPreviewProps['view']>) => void
  setAssembly: (assembly: NonNullable<SpeakerPreviewProps['assembly']>) => void
  resetKey: number
  retryKey: number
  onResetCamera: () => void
  onShare: () => void
  onSaveDesign: () => void
  onLoadDesign: () => void
  variationSession: DesignVariation[] | null
  onExploreVariations: () => void
  onCancelVariations: () => void
  onChooseVariation: (design: Design) => void
}

export function DesignerPreview({
  design,
  meshes,
  view,
  presentation,
  setPresentation,
  assembly,
  setView,
  setAssembly,
  resetKey,
  retryKey,
  onResetCamera,
  onShare,
  onSaveDesign,
  onLoadDesign,
  variationSession,
  onExploreVariations,
  onCancelVariations,
  onChooseVariation,
}: Props) {
  const exploringVariations = variationSession !== null
  const variationTrigger = useRef<HTMLButtonElement>(null)
  const wasExploring = useRef(false)
  useEffect(() => {
    if (wasExploring.current && !exploringVariations)
      variationTrigger.current?.focus({ preventScroll: true })
    wasExploring.current = exploringVariations
  }, [exploringVariations])
  const {
    previewGeometry,
    previewKnobGeometry,
    previewPowerButtonGeometry,
    error,
    generating,
    knobGenerating,
    powerButtonGenerating,
    previewMaterialParts,
    multicolorGenerating,
  } = meshes
  if (variationSession)
    return (
      <VariationWorkspace
        design={design}
        initialVariations={variationSession}
        meshes={meshes}
        onCancel={onCancelVariations}
        onChoose={onChooseVariation}
      />
    )
  return (
    <div
      className="preview-column"
      data-materials-ready={
        !design.multicolor.enabled || !!meshes.materialParts
      }
    >
      <div className="preview-card">
        <PreviewCameraControls
          view={view}
          presentation={presentation}
          setPresentation={setPresentation}
          setView={setView}
          onResetCamera={onResetCamera}
          disabled={!previewGeometry || !!error}
          variationTrigger={variationTrigger}
          onExploreVariations={onExploreVariations}
          variationsDisabled={
            !meshes.geometry ||
            !meshes.knobGeometry ||
            !meshes.powerButtonGeometry ||
            !!error ||
            (design.multicolor.enabled && !meshes.materialParts)
          }
        />
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
                bodyColor={design.bodyColor}
                bodyGrilleColor={design.bodyGrilleColor}
                style="original"
                panelColor={design.panelColor}
                materialParts={previewMaterialParts}
                materials={design.multicolor.materials}
                knobColor={design.knobColor}
                knobGeometry={previewKnobGeometry}
                powerButtonColor={design.powerButtonColor}
                powerButtonGeometry={previewPowerButtonGeometry}
                knobStyle={design.knob.style}
                relief={design.relief}
                view={view}
                presentation={presentation}
                onStopPresentation={() => setPresentation(false)}
                assembly={assembly}
                resetKey={resetKey}
              />
            </Suspense>
          </PreviewLoadBoundary>
        </div>
        {(generating ||
          knobGenerating ||
          powerButtonGenerating ||
          multicolorGenerating) &&
          previewGeometry && (
            <div className="geometry-updating" role="status">
              <LoaderCircle className="spin" size={12} /> Updating geometry…
            </div>
          )}
        <div className="preview-bottom">
          <PreviewSummary design={design} meshes={meshes} assembly={assembly} />
          <div className="preview-actions">
            <button
              title="Reset camera"
              aria-label="Reset camera"
              onClick={onResetCamera}
            >
              <RotateCcw size={16} />
            </button>
            <button
              title="Share design"
              aria-label="Copy design link"
              onClick={onShare}
            >
              <Copy size={16} />
            </button>
            <button
              title="Save design JSON"
              aria-label="Save design JSON"
              onClick={onSaveDesign}
            >
              <FileDown size={16} aria-hidden="true" />
            </button>
            <button
              title="Load design JSON"
              aria-label="Load design JSON"
              onClick={onLoadDesign}
            >
              <FolderOpen size={16} aria-hidden="true" />
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
            <MousePointer2 size={13} />{' '}
            {presentation
              ? 'Presenting · Drag to take control'
              : 'Drag to rotate · Pinch or scroll to zoom'}
          </span>
        </div>
      </div>
    </div>
  )
}

function PreviewCameraControls({
  view,
  presentation,
  setPresentation,
  setView,
  onResetCamera,
  disabled,
  variationTrigger,
  onExploreVariations,
  variationsDisabled,
}: Pick<
  Props,
  'view' | 'presentation' | 'setPresentation' | 'setView' | 'onResetCamera'
> & {
  disabled: boolean
  variationTrigger: React.RefObject<HTMLButtonElement | null>
  onExploreVariations: () => void
  variationsDisabled: boolean
}) {
  return (
    <div className="preview-topbar">
      <div className="preview-status">
        <span className="eyebrow">
          <span className="live-dot" /> PREVIEW
        </span>
        <button
          className="presentation-toggle"
          title={presentation ? 'Stop presentation' : 'Start presentation'}
          aria-label="Presentation mode"
          aria-pressed={presentation}
          aria-description="Automatically circle the speaker from changing heights. Drag the preview to take control."
          disabled={disabled}
          onClick={() => setPresentation(!presentation)}
        >
          {presentation ? <Pause size={16} /> : <Play size={16} />}
          <span className="presentation-label">
            {presentation ? 'Pause' : 'Present'}
          </span>
        </button>
        <button
          ref={variationTrigger}
          className="presentation-toggle variation-toggle"
          aria-label="Explore variations"
          title="Explore variations without changing your design"
          disabled={variationsDisabled}
          onClick={onExploreVariations}
        >
          <Sparkles size={16} aria-hidden="true" />
          <span className="presentation-label">Variations</span>
        </button>
      </div>
      <div className="view-switch" role="group" aria-label="Camera view">
        <button
          className={!presentation && view === 'perspective' ? 'active' : ''}
          aria-pressed={!presentation && view === 'perspective'}
          onClick={() => {
            setView('perspective')
            onResetCamera()
          }}
        >
          <Box size={14} /> 3D view
        </button>
        <button
          className={!presentation && view === 'front' ? 'active' : ''}
          aria-pressed={!presentation && view === 'front'}
          onClick={() => {
            setView('front')
            onResetCamera()
          }}
        >
          Front
        </button>
      </div>
    </div>
  )
}

function PreviewSummary({
  design,
  meshes,
  assembly,
}: Pick<Props, 'design' | 'meshes' | 'assembly'>) {
  const { panelLabel, knobLabel } = getDesignSummary(design)
  const { panelWidth, panelHeight, knobDimensions } = meshes
  return (
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
        {design.multicolor.enabled && assembly !== 'knob'
          ? `${meshes.materialParts?.length ?? '…'} MATERIALS`
          : colorName(
              assembly === 'knob' ? design.knobColor : design.panelColor,
            ).toUpperCase()}
      </span>
    </div>
  )
}
