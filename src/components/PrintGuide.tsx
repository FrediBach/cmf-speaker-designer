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
          Export your panel and knob, prepare them in a slicer, and check the
          first print.
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
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h4>Slice at 100% scale</h4>
              <p>
                Choose STL in the export dialog for slicing. Unzip a full design
                download to find separate panel and knob files and your saved
                colors and settings. Import the STLs in millimeters; each part
                is placed on the build plate. Review overhangs and supports in
                your slicer before printing. Choose STP for faceted STEP
                geometry in CAD applications; these files preserve the mesh
                without parametric feature history.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h4>Test the first print</h4>
              <p>
                Printer tolerances vary. Test the fit before making a full set.
                Generated handles, panel gaps, and custom face depth have not
                been physically tested. Check that the attachments lock and the
                controls move freely. Test strength before using a printed
                handle to carry a speaker.
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
