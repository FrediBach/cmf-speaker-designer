import { useState, type RefObject } from 'react'
import { ArrowDownToLine, Check, LoaderCircle, Power } from 'lucide-react'
import { Button } from './ui/button'
import { PanelIcon } from './PanelIcon'
import { KnobIcon } from './KnobIcon'
import { colorName, type Design } from '@/lib/design'
import { getDesignSummary } from '@/lib/design-summary'
import {
  getHandleHoleCenters,
  getHandleSlits,
  getHandleStudCenters,
  getHandleSvgPaths,
} from '@/lib/handle-settings'
import type {
  DesignExportFormat,
  DesignExportTarget,
} from '@/lib/design-export'
import type { useDesignGeometry } from '@/lib/use-design-geometry'
import { STEP_TOLERANCE_MM } from '@/lib/step-settings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
  design: Design
  meshes: ReturnType<typeof useDesignGeometry>
  onNotify: (message: string) => void
}

export function ExportDialog({
  open,
  onOpenChange,
  triggerRef,
  design,
  meshes,
  onNotify,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [exportTarget, setExportTarget] = useState<DesignExportTarget>('all')
  const includesPanel = exportTarget === 'all' || exportTarget === 'panel'
  const includesKnob = exportTarget === 'all' || exportTarget === 'knob'
  const includesPowerButton =
    exportTarget === 'all' || exportTarget === 'power-button'
  const [formatChoice, setFormatChoice] = useState<{
    multicolor: boolean
    format: DesignExportFormat
  } | null>(null)
  const exportFormat =
    formatChoice?.multicolor === design.multicolor.enabled
      ? formatChoice.format
      : design.multicolor.enabled
        ? '3mf'
        : 'stl'
  const setExportFormat = (format: DesignExportFormat) =>
    setFormatChoice({ multicolor: design.multicolor.enabled, format })
  const formatLabel =
    exportFormat === 'stl-parts' ? 'STL parts' : exportFormat.toUpperCase()
  const isMaterialExport =
    exportFormat === '3mf' || exportFormat === 'stl-parts'
  const geometryLabel =
    exportFormat === 'stp'
      ? 'Faceted STEP'
      : exportFormat === '3mf'
        ? 'Multipart 3MF'
        : exportFormat === 'stl-parts'
          ? 'Aligned material STLs'
          : 'Binary STL'
  const {
    geometry,
    knobGeometry,
    powerButtonGeometry,
    panelWidth,
    panelHeight,
    knobDimensions,
    powerButtonDimensions,
    materialParts,
    multicolorError,
    multicolorDiagnostics,
  } = meshes
  const regionsReady =
    !design.multicolor.enabled ||
    !includesPanel ||
    !isMaterialExport ||
    !!materialParts
  const { knobLabel } = getDesignSummary(design)
  async function exportDesign() {
    if (
      !geometry ||
      !knobGeometry ||
      !powerButtonGeometry ||
      !regionsReady ||
      busy
    )
      return
    setBusy(true)
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      )
      const { downloadDesignExport } = await import('@/lib/design-export')
      await downloadDesignExport({
        panel: geometry,
        knob: knobGeometry,
        powerButton: powerButtonGeometry,
        design,
        target: exportTarget,
        format: exportFormat,
        materialParts,
      })
      onOpenChange(false)
      onNotify(
        exportTarget === 'all'
          ? 'Panel, knob, power button, and design settings downloaded.'
          : `${formatLabel} downloaded.`,
      )
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : exportFormat === 'stp'
            ? 'The STP export could not be created. Try STL to download the mesh.'
            : 'The download could not start. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open)
      }}
    >
      <DialogContent
        className="export-content"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <div className="dialog-icon">
          <ArrowDownToLine size={23} />
        </div>
        <span className="eyebrow">EXPORT / {formatLabel}</span>
        <DialogTitle>Export design</DialogTitle>
        <DialogDescription>
          {isMaterialExport
            ? 'Full-size material regions in millimeters. Keep the panel assembled and assign a filament to each named part in your slicer.'
            : exportFormat === 'stp'
              ? 'Full-size STEP parts in millimeters for your CAD application.'
              : 'Full-size parts in millimeters. Open each STL in your slicer at 100% scale.'}
        </DialogDescription>
        <div
          className="handle-mode export-formats"
          role="group"
          aria-label="Export format"
        >
          {(
            [
              '3mf',
              ...(design.multicolor.enabled && includesPanel
                ? ['stl-parts' as const]
                : []),
              'stl',
              'stp',
            ] as const
          ).map((format) => (
            <button
              key={format}
              aria-pressed={exportFormat === format}
              className={exportFormat === format ? 'active' : ''}
              disabled={busy}
              onClick={() => setExportFormat(format)}
            >
              {format === 'stl-parts' ? 'STL parts' : format.toUpperCase()}
            </button>
          ))}
        </div>
        <div
          className="handle-mode export-targets"
          role="group"
          aria-label="Export parts"
        >
          {(
            [
              { id: 'all', label: 'All parts' },
              { id: 'panel', label: 'Panel only' },
              { id: 'knob', label: 'Knob only' },
              { id: 'power-button', label: 'Power button only' },
            ] as const
          ).map((target) => (
            <button
              key={target.id}
              aria-pressed={exportTarget === target.id}
              className={exportTarget === target.id ? 'active' : ''}
              disabled={busy}
              onClick={() => {
                setExportTarget(target.id)
                if (
                  (target.id === 'knob' || target.id === 'power-button') &&
                  exportFormat === 'stl-parts'
                )
                  setExportFormat('3mf')
              }}
            >
              {target.label}
            </button>
          ))}
        </div>
        {includesPanel && (
          <PanelExportSummary
            design={design}
            panelWidth={panelWidth}
            panelHeight={panelHeight}
            geometryLabel={geometryLabel}
          />
        )}
        {includesKnob && (
          <div className="download-summary knob-download-summary">
            <KnobIcon style={design.knob.style} />
            <div>
              <strong>{knobLabel} volume knob</strong>
              <span>
                {knobDimensions ? `${knobDimensions} mm · ` : ''}
                {geometryLabel}
              </span>
              <span>{colorName(design.knobColor)} · Fits Speaker S & M</span>
            </div>
            <span
              className="summary-swatch"
              style={{ background: design.knobColor }}
            />
          </div>
        )}
        {includesPowerButton && (
          <div className="download-summary power-button-download-summary">
            <Power aria-hidden="true" />
            <div>
              <strong>Original power button</strong>
              <span>
                {powerButtonDimensions ? `${powerButtonDimensions} mm · ` : ''}
                {geometryLabel}
              </span>
              <span>
                {colorName(design.powerButtonColor)} · Fits Speaker S & M
              </span>
              <span>Factory indicator marking is preview only.</span>
            </div>
            <span
              className="summary-swatch"
              style={{ background: design.powerButtonColor }}
            />
          </div>
        )}
        {design.multicolor.enabled && includesPanel && (
          <div className="multicolor-export-summary">
            {isMaterialExport ? (
              <>
                <strong>
                  {materialParts?.length ?? '…'} used materials · Full-depth
                  regions
                </strong>
                <div className="multicolor-export-materials">
                  {materialParts?.map((part) => {
                    const material =
                      part.materialId === 'base'
                        ? { name: 'Background', color: design.panelColor }
                        : design.multicolor.materials.find(
                            (item) => item.id === part.materialId,
                          )
                    return (
                      material && (
                        <span key={part.materialId}>
                          <i style={{ background: material.color }} />
                          {material.name}
                        </span>
                      )
                    )
                  })}
                </div>
                {!!multicolorDiagnostics.length && (
                  <details>
                    <summary>
                      Pattern notes ({multicolorDiagnostics.length})
                    </summary>
                    {multicolorDiagnostics.map((note, index) => (
                      <p key={index}>{note}</p>
                    ))}
                  </details>
                )}
              </>
            ) : (
              <p>
                <strong>Combined geometry only.</strong> This {formatLabel}{' '}
                joins the panel into one solid and discards material separation.
                Choose 3MF or STL parts for multicolor printing.
              </p>
            )}
          </div>
        )}
        <div className="download-notes">
          <p>
            <Check size={15} />{' '}
            {includesPanel && design.panelGap > 0
              ? 'Extended attachments and rear support posts'
              : 'Original mounting features retained'}
          </p>
          <p>
            <Check size={15} />{' '}
            {isMaterialExport && includesPanel
              ? 'Panel regions share one assembly position'
              : 'Separate parts, positioned on the build plate'}
          </p>
          {exportTarget === 'all' && !isMaterialExport && (
            <p>
              <Check size={15} /> ZIP includes all three {formatLabel} files and
              design.json with your colors and settings
            </p>
          )}
        </div>
        <p className="export-caveat">
          {isMaterialExport
            ? 'Confirm filament assignments in your slicer. Use compatible materials, inspect sliced boundaries and supports, and test fit and bonding before using the panel. 3MF display colors do not select printer filament slots.'
            : exportFormat === 'stp'
              ? `Faceted STEP with ${STEP_TOLERANCE_MM} mm surface tolerance, without smooth CAD surfaces or parametric feature history. ${exportTarget === 'all' ? 'Colors are saved in the ZIP’s design.json.' : 'Choose All parts to include colors and settings in a ZIP.'}`
              : 'STL files don’t store colors. Match your selected colors with filament. Review supports in your slicer and test-fit your first print.'}
        </p>
        <div className="export-actions">
          <Button
            className="confirm-download"
            onClick={exportDesign}
            disabled={
              busy ||
              !geometry ||
              !knobGeometry ||
              !powerButtonGeometry ||
              !regionsReady ||
              (isMaterialExport && includesPanel && !!multicolorError)
            }
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <ArrowDownToLine size={17} />
            )}{' '}
            {busy
              ? 'Preparing files…'
              : exportFormat === '3mf'
                ? 'Download 3MF'
                : exportFormat === 'stl-parts' || exportTarget === 'all'
                  ? 'Download ZIP'
                  : `Download ${formatLabel}`}
            <span>Speaker {design.model.toUpperCase()}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function handleCutoutSummary({ model, handle }: Design) {
  if (handle.cutout === 'none') return 'Solid'
  if (handle.cutout === 'svg') {
    if (!handle.svgCutout) return 'Solid · no SVG uploaded'
    const count = getHandleSvgPaths(model, handle).length
    if (!count) return 'Solid · SVG cutout omitted'
    const total = handle.svgCutout.paths.length
    return `SVG cutout · ${handle.svgCutout.name}${count < total ? ` · ${count} of ${total} shapes` : ''}`
  }
  const count =
    handle.cutout === 'slits'
      ? getHandleSlits(model, handle).length
      : getHandleHoleCenters(model, handle).length
  const amount =
    count === handle.holeCount ? `${count}` : `${count} of ${handle.holeCount}`
  if (handle.cutout === 'slits')
    return `${amount} top ${handle.holeCount === 1 ? 'slit' : 'slits'} · ${handle.holeHeight} mm deep`
  const shape = handle.cutout === 'circle' ? 'round' : 'slot'
  return `${amount} ${shape} ${handle.holeCount === 1 ? 'hole' : 'holes'}`
}

function handleTopSummary(handle: Design['handle']) {
  if (handle.topShape === 'straight' && handle.topAngle === 0) return ''
  const shape = {
    straight: 'Straight',
    outward: 'Outward rounded',
    inward: 'Inward rounded',
  }[handle.topShape]
  return ` · ${shape} top · ${Number(handle.topAngle.toFixed(2))}° angle${handle.topShape !== 'straight' ? ` · ${Number(handle.topCurve.toFixed(2))} mm curve` : ''}`
}

function PanelExportSummary({
  design,
  panelWidth,
  panelHeight,
  geometryLabel,
}: {
  design: Design
  panelWidth: number
  panelHeight: number
  geometryLabel: string
}) {
  const { panelLabel, customHalo, haloLabel } = getDesignSummary(design)
  return (
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
          · {geometryLabel}
        </span>
        {design.panelExtension > 0 && (
          <span>
            Side extension · {(design.panelExtension / 10).toFixed(2)} cm per
            side
          </span>
        )}
        {design.panelGap > 0 && (
          <span>
            Panel gap · {(design.panelGap / 10).toFixed(2)} cm · Recessed
            controls
          </span>
        )}
        {design.handle.mode === 'custom' && (
          <span>
            Custom handle · {design.handle.height} mm extension ·{' '}
            {design.handle.width} mm wide
            {handleTopSummary(design.handle)} · {handleCutoutSummary(design)}
            {design.handle.legoStuds
              ? getHandleStudCenters(
                  design.model,
                  design.handle,
                  design.raceStripes,
                ).length
                ? ' · LEGO-compatible studs'
                : ' · LEGO-compatible studs omitted'
              : ''}
          </span>
        )}
        {design.grille.mode === 'custom' && (
          <span>
            Custom grille · {design.grille.size} mm openings ·{' '}
            {design.grille.spacing} mm spacing · {design.grille.thickness} mm
            thick
            {design.grille.extendPattern
              ? ` · ${design.grille.recessDepth} mm recessed face pattern`
              : ''}
          </span>
        )}
        {design.raceStripes.enabled && (
          <span>
            {design.raceStripes.count} recessed race{' '}
            {design.raceStripes.count === 1 ? 'stripe' : 'stripes'} ·{' '}
            {design.raceStripes.width} mm wide
            {design.raceStripes.count > 1
              ? ` · ${design.raceStripes.gap} mm gap`
              : ''}
          </span>
        )}
        {customHalo && (
          <span>
            {haloLabel} · {design.halo.depth} mm depth · {design.halo.thickness}{' '}
            mm wall · {design.halo.outwardAngle}° outward ·{' '}
            {design.halo.cutAngle}° cut · {design.halo.cutRotation}° rotation ·{' '}
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
  )
}
