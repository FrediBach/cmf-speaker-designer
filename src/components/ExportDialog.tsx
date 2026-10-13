import { useState, type RefObject } from 'react'
import { ArrowDownToLine, Check, LoaderCircle } from 'lucide-react'
import { Button } from './ui/button'
import { PanelIcon } from './PanelIcon'
import { KnobIcon } from './KnobIcon'
import { colorName, type Design } from '@/lib/design'
import { getDesignSummary } from '@/lib/design-summary'
import type { DesignExportTarget } from '@/lib/design-export'
import type { useDesignGeometry } from '@/lib/use-design-geometry'
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
  const [exportTarget, setExportTarget] = useState<DesignExportTarget>('both')
  const { geometry, knobGeometry, panelWidth, panelHeight, knobDimensions } =
    meshes
  const { knobLabel } = getDesignSummary(design)
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
      onOpenChange(false)
      onNotify(
        exportTarget === 'both'
          ? 'Panel, knob, and design settings downloaded.'
          : 'STL downloaded.',
      )
    } catch {
      onNotify('The download could not start. Please try again.')
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
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
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
          <PanelExportSummary
            design={design}
            panelWidth={panelWidth}
            panelHeight={panelHeight}
          />
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
  )
}

function PanelExportSummary({
  design,
  panelWidth,
  panelHeight,
}: {
  design: Design
  panelWidth: number
  panelHeight: number
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
            {design.grille.spacing} mm spacing · {design.grille.thickness} mm
            thick
            {design.grille.extendPattern
              ? ` · ${design.grille.recessDepth} mm recessed face pattern`
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
