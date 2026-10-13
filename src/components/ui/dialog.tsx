import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogTitle = DialogPrimitive.Title
const DialogDescription = DialogPrimitive.Description
function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content
        className={cn('dialog-content', className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="dialog-close"
          aria-label="Close dialog"
        >
          <X size={20} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
export { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription }
