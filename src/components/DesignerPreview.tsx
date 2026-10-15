import { lazy, Suspense } from 'react'
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
} from 'lucide-react'
import { PreviewLoadBoundary } from './PreviewLoadBoundary'
import type { SpeakerPreviewProps } from './SpeakerPreview'
import { colorName, type Design } from '@/lib/design'
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
}: Props) {
  const {
    previewGeometry,
    previewKnobGeometry,
    previewPowerButtonGeometry,
    error,
    generating,
    knobGenerating,
    powerButtonGenerating,
    panelWidth,
    panelHeight,
    knobDimensions,
    previewMaterialParts,
    multicolorGenerating,
  } = meshes
  const { panelLabel, knobLabel } = getDesignSummary(design)
  return (
    <div
      className="preview-column"
      data-materials-ready={
        !design.multicolor.enabled || !!meshes.materialParts
      }
    >
      <div className="preview-card">
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
              disabled={!previewGeometry || !!error}
              onClick={() => setPresentation(!presentation)}
            >
              {presentation ? <Pause size={16} /> : <Play size={16} />}
              <span className="presentation-label">
                {presentation ? 'Pause' : 'Present'}
              </span>
            </button>
          </div>
          <div className="view-switch" role="group" aria-label="Camera view">
            <button
              className={
                !presentation && view === 'perspective' ? 'active' : ''
              }
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
