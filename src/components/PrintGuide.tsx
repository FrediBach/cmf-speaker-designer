import type { RefObject } from 'react'
import { ArrowUpRight, Layers3 } from 'lucide-react'
import { COMMUNITY_URL } from '@/lib/community'
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
}

export function PrintGuide({ open, onOpenChange, triggerRef }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <div className="dialog-icon">
          <Layers3 size={23} />
        </div>
        <span className="eyebrow">REFERENCE / 01</span>
        <DialogTitle>Print guide</DialogTitle>
        <DialogDescription>
          Export your panel, knob, and power button, prepare them in a slicer,
          and check the first print.
        </DialogDescription>
        <ol className="print-steps">
          <li>
            <span>01</span>
            <div>
              <h4>Configure the panel</h4>
              <p>
                Choose Speaker S or M and a panel shape. Added face depth
                thickens the front while retaining the original mounting
                features and folded controls. Panel gap raises the front and
                angled section with extended attachments and rear support posts;
                the knob and button stay in recessed openings. In the Halo tab,
                adjust the ring profile and base rim, or tilt its front cut into
                a hood. Combine it with your own opening pattern in the Grille
                tab. In the Handle tab, generate a new upper extension and
                openings. In the Knob tab, shape the upper grip while retaining
                the original base and socket dimensions.
              </p>
              <p>
                Enable Split front and upper panel in Front panel → Print
                assembly to separate the panel where its angled section starts.
                Slide the upper part's tongue down into the groove inside the
                front plate's top edge before attaching the assembled panel to
                the speaker. The groove stays within the plate's thickness,
                keeping the back flush. A small solid area around the joint may
                back the uppermost openings when the grille continues across the
                face.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h4>Choose your filament</h4>
              <p>
                PLA is a good starting point. PETG is another option for
                frequently handled parts. The STL contains geometry; set colors
                by choosing filament.
              </p>
              <p>
                For multicolor, choose compatible filaments and assign each
                named material part to a filament in your slicer. The pattern
                runs through the panel's full depth, including handles and
                mounting features. More materials can require more tool changes
                and purge material.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h4>Slice at 100% scale</h4>
              <p>
                Choose STL in the export dialog for slicing. Unzip a full design
                download to find separate panel, knob, and power button files
                and your saved colors and settings. Import the STLs in
                millimeters; each part is placed on the build plate. Review
                overhangs and supports in your slicer before printing. Choose
                STP for faceted STEP geometry in CAD applications; these files
                preserve the mesh without parametric feature history.
              </p>
              <p>
                The power button uses the supplied original shape for both
                speaker sizes. Its color is independent of the panel and knob.
                The white factory indicator shown in the preview is not part of
                the printable button.
              </p>
              <p>
                Multicolor designs default to 3MF, with separate material
                regions within each printable object. With split assembly, print
                the front and upper panel as two objects. The STL parts ZIP is
                an alternative: import each panel's material files together as
                parts of one object. Keep their common positions; do not center
                or drop color regions onto the plate individually. Assign
                filaments and inspect the sliced layers. Combined STL/STP
                exports contain geometry only. Small regions may disappear in
                slicing; adjust the pattern for your nozzle and line width.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h4>Test the first print</h4>
              <p>
                Printer tolerances vary. Test the fit before making a full set.
                Generated handles, split panel joints, panel gaps, and custom
                face depth have not been physically tested. Check that the
                attachments lock, the sliding joint fits, and the controls move
                freely. Test strength before using a printed handle to carry a
                speaker.
              </p>
              <p>
                Multicolor material interfaces also need physical bonding and
                strength tests. An unchanged panel shape does not establish
                unchanged strength. Check a small color-boundary coupon first.
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
  )
}
