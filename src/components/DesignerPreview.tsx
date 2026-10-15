import { lazy, Suspense } from 'react'
import {
  Box,
  Copy,
  Layers3,
  LoaderCircle,
  MousePointer2,
  MoveUpRight,
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
  assembly: NonNullable<SpeakerPreviewProps['assembly']>
  setView: (view: NonNullable<SpeakerPreviewProps['view']>) => void
  setAssembly: (assembly: NonNullable<SpeakerPreviewProps['assembly']>) => void
  resetKey: number
  retryKey: number
  onResetCamera: () => void
  onShare: () => void
}

export function DesignerPreview({
  design,
  meshes,
  view,
  assembly,
  setView,
  setAssembly,
  resetKey,
  retryKey,
  onResetCamera,
  onShare,
}: Props) {
  const {
    previewGeometry,
    previewKnobGeometry,
    error,
    generating,
    knobGenerating,
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
          <span className="eyebrow">
            <span className="live-dot" /> PREVIEW
          </span>
          <div className="view-switch" role="group" aria-label="Camera view">
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
                bodyColor={design.bodyColor}
                bodyGrilleColor={design.bodyGrilleColor}
                style="original"
                panelColor={design.panelColor}
                materialParts={previewMaterialParts}
                materials={design.multicolor.materials}
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
        {(generating || knobGenerating || multicolorGenerating) &&
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
            <MousePointer2 size={13} /> Drag to rotate · Pinch or scroll to zoom
          </span>
        </div>
      </div>
    </div>
  )
}
