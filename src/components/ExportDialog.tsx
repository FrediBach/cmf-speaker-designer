import { useState, type RefObject } from 'react'
import { ArrowDownToLine, Check, LoaderCircle, Power } from 'lucide-react'
import { Button } from './ui/button'
import { PanelIcon } from './PanelIcon'
import { KnobIcon } from './KnobIcon'
import { colorName, type Design } from '@/lib/design'
import { getDesignSummary } from '@/lib/design-summary'
import { getHaloWaveAmplitude, getHaloWaveFrequency } from '@/lib/halo-settings'
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

const EXPORT_FORMAT_DETAILS = {
  stl: {
    label: 'STL',
    materialExport: false,
    geometryLabel: 'Binary STL',
    description:
      'Full-size parts in millimeters. Open each STL in your slicer at 100% scale.',
  },
  stp: {
    label: 'STP',
    materialExport: false,
    geometryLabel: 'Faceted STEP',
    description:
      'Full-size STEP parts in millimeters for your CAD application.',
  },
  '3mf': {
    label: '3MF',
    materialExport: true,
    geometryLabel: 'Multipart 3MF',
    description:
      'Full-size material regions in millimeters. Keep the panel assembled and assign a filament to each named part in your slicer.',
  },
  'stl-parts': {
    label: 'STL parts',
    materialExport: true,
    geometryLabel: 'Aligned material STLs',
    description:
      'Full-size material regions in millimeters. Keep the panel assembled and assign a filament to each named part in your slicer.',
  },
} satisfies Record<
  DesignExportFormat,
  {
    label: string
    materialExport: boolean
    geometryLabel: string
    description: string
  }
>

/** Remember a format choice only for the color mode in which it was selected. */
function useExportFormat(multicolor: boolean) {
  const [formatChoice, setFormatChoice] = useState<{
    multicolor: boolean
    format: DesignExportFormat
  } | null>(null)
  const exportFormat =
    formatChoice?.multicolor === multicolor
      ? formatChoice.format
      : multicolor
        ? '3mf'
        : 'stl'
  const setExportFormat = (format: DesignExportFormat) =>
    setFormatChoice({ multicolor: multicolor, format })
  return { exportFormat, setExportFormat }
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
  const { exportFormat, setExportFormat } = useExportFormat(
    design.multicolor.enabled,
  )
  const {
    label: formatLabel,
    materialExport: isMaterialExport,
    geometryLabel,
    description,
  } = EXPORT_FORMAT_DETAILS[exportFormat]
  const {
    geometry,
    knobGeometry,
    powerButtonGeometry,
    materialParts,
    multicolorError,
  } = meshes
  const regionsReady =
    !design.multicolor.enabled ||
    !includesPanel ||
    !isMaterialExport ||
    !!materialParts
  const ready =
    !!geometry &&
    !!knobGeometry &&
    !!powerButtonGeometry &&
    regionsReady &&
    !busy
  async function exportDesign() {
    if (!ready) return
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
        <DialogDescription>{description}</DialogDescription>
        <ExportChoices
          multicolor={design.multicolor.enabled}
          target={exportTarget}
          format={exportFormat}
          busy={busy}
          onTargetChange={setExportTarget}
          onFormatChange={setExportFormat}
        />
        <ExportPartSummaries
          design={design}
          meshes={meshes}
          target={exportTarget}
          geometryLabel={geometryLabel}
        />
        {design.multicolor.enabled && includesPanel && (
          <MaterialExportSummary
            design={design}
            meshes={meshes}
            isMaterialExport={isMaterialExport}
            formatLabel={formatLabel}
          />
        )}
        <ExportNotes
          extendedAttachments={includesPanel && design.panelGap > 0}
          includesPanel={includesPanel}
          isMaterialExport={isMaterialExport}
          exportTarget={exportTarget}
          exportFormat={exportFormat}
          formatLabel={formatLabel}
        />
        <ExportDownloadButton
          busy={busy}
          disabled={
            !ready || (isMaterialExport && includesPanel && !!multicolorError)
          }
          onClick={exportDesign}
          exportFormat={exportFormat}
          exportTarget={exportTarget}
          formatLabel={formatLabel}
          model={design.model}
        />
      </DialogContent>
    </Dialog>
  )
}

function ExportDownloadButton({
  busy,
  disabled,
  onClick,
  exportFormat,
  exportTarget,
  formatLabel,
  model,
}: {
  busy: boolean
  disabled: boolean
  onClick: () => void
  exportFormat: DesignExportFormat
  exportTarget: DesignExportTarget
  formatLabel: string
  model: Design['model']
}) {
  return (
    <div className="export-actions">
      <Button
        className="confirm-download"
        onClick={onClick}
        disabled={disabled}
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
        <span>Speaker {model.toUpperCase()}</span>
      </Button>
    </div>
  )
}

function ExportChoices({
  multicolor,
  target: selectedTarget,
  format: selectedFormat,
  busy,
  onTargetChange,
  onFormatChange,
}: {
  multicolor: boolean
  target: DesignExportTarget
  format: DesignExportFormat
  busy: boolean
  onTargetChange: (target: DesignExportTarget) => void
  onFormatChange: (format: DesignExportFormat) => void
}) {
  const includesPanel = selectedTarget === 'all' || selectedTarget === 'panel'
  return (
    <>
      <div
        className="handle-mode export-formats"
        role="group"
        aria-label="Export format"
      >
        {(
          [
            '3mf',
            ...(multicolor && includesPanel ? ['stl-parts' as const] : []),
            'stl',
            'stp',
          ] as const
        ).map((format) => (
          <button
            key={format}
            aria-pressed={selectedFormat === format}
            className={selectedFormat === format ? 'active' : ''}
            disabled={busy}
            onClick={() => onFormatChange(format)}
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
            aria-pressed={selectedTarget === target.id}
            className={selectedTarget === target.id ? 'active' : ''}
            disabled={busy}
            onClick={() => {
              onTargetChange(target.id)
              if (
                (target.id === 'knob' || target.id === 'power-button') &&
                selectedFormat === 'stl-parts'
              )
                onFormatChange('3mf')
            }}
          >
            {target.label}
          </button>
        ))}
      </div>
    </>
  )
}

function ExportNotes({
  extendedAttachments,
  includesPanel,
  isMaterialExport,
  exportTarget,
  exportFormat,
  formatLabel,
}: {
  extendedAttachments: boolean
  includesPanel: boolean
  isMaterialExport: boolean
  exportTarget: DesignExportTarget
  exportFormat: DesignExportFormat
  formatLabel: string
}) {
  return (
    <>
      <div className="download-notes">
        <p>
          <Check size={15} />{' '}
          {extendedAttachments
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
    </>
  )
}

function ExportPartSummaries({
  design,
  meshes,
  target,
  geometryLabel,
}: {
  design: Design
  meshes: Props['meshes']
  target: DesignExportTarget
  geometryLabel: string
}) {
  const includesPanel = target === 'all' || target === 'panel'
  const includesKnob = target === 'all' || target === 'knob'
  const includesPowerButton = target === 'all' || target === 'power-button'
  const { panelWidth, panelHeight, knobDimensions, powerButtonDimensions } =
    meshes
  const { knobLabel } = getDesignSummary(design)
  return (
    <>
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
    </>
  )
}

function MaterialExportSummary({
  design,
  meshes,
  isMaterialExport,
  formatLabel,
}: {
  design: Design
  meshes: Props['meshes']
  isMaterialExport: boolean
  formatLabel: string
}) {
  const { materialParts, multicolorDiagnostics } = meshes
  return (
    <div className="multicolor-export-summary">
      {isMaterialExport ? (
        <>
          <strong>
            {materialParts?.length ?? '…'} used materials · Full-depth regions
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
              <summary>Pattern notes ({multicolorDiagnostics.length})</summary>
              {multicolorDiagnostics.map((note, index) => (
                <p key={index}>{note}</p>
              ))}
            </details>
          )}
        </>
      ) : (
        <p>
          <strong>Combined geometry only.</strong> This {formatLabel} joins the
          panel into one solid and discards material separation. Choose 3MF or
          STL parts for multicolor printing.
        </p>
      )}
    </div>
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
            {design.grille.extendPattern && design.grille.recessDepth !== 0
              ? ` · ${Math.abs(design.grille.recessDepth)} mm ${design.grille.recessDepth < 0 ? 'raised' : 'recessed'} face pattern`
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
            {getHaloWaveAmplitude(design.halo) > 0 &&
              ` · ${design.halo.waveShape} wave · ${Number(getHaloWaveAmplitude(design.halo).toFixed(2))} mm amplitude · ${getHaloWaveFrequency(design.halo)} cycles · ${design.halo.wavePhase}° phase${design.halo.waveSeamless ? ' · seamless' : ''}`}
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
