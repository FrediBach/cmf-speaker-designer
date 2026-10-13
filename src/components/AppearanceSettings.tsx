import { useRef } from 'react'
import { Check, Moon, Sun } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useAppearance, type Appearance } from '@/lib/appearance'

export function AppearanceSettings() {
  const [appearance, setAppearance] = useAppearance()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const ThemeIcon = appearance.theme === 'dark' ? Moon : Sun

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="appearance-trigger"
          aria-label="Appearance"
          title="Appearance"
        >
          <ThemeIcon size={18} aria-hidden="true" />
          <span className="appearance-trigger-label">Appearance</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className="appearance-content"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
      >
        <DialogTitle>Appearance</DialogTitle>
        <DialogDescription>
          Choose a theme and interface accent.
        </DialogDescription>

        <section className="appearance-section">
          <h3>Theme</h3>
          <div className="appearance-options" role="group" aria-label="Theme">
            {(['light', 'dark'] as const).map((theme) => {
              const Icon = theme === 'dark' ? Moon : Sun
              return (
                <button
                  key={theme}
                  type="button"
                  className="appearance-option"
                  aria-pressed={appearance.theme === theme}
                  onClick={() =>
                    setAppearance((current) => ({ ...current, theme }))
                  }
                >
                  <Icon size={20} aria-hidden="true" />
                  <span>{theme === 'light' ? 'Light' : 'Dark'}</span>
                  {appearance.theme === theme && (
                    <Check
                      className="appearance-option-check"
                      size={18}
                      aria-hidden="true"
                    />
                  )}
                </button>
              )
            })}
          </div>
        </section>

        <section className="appearance-section">
          <h3>Interface accent</h3>
          <div
            className="appearance-options"
            role="group"
            aria-label="Interface accent"
          >
            {(['orange', 'turquoise'] satisfies Appearance['accent'][]).map(
              (accent) => (
                <button
                  key={accent}
                  type="button"
                  className="appearance-option"
                  aria-pressed={appearance.accent === accent}
                  onClick={() =>
                    setAppearance((current) => ({ ...current, accent }))
                  }
                >
                  <span
                    className="appearance-accent-swatch"
                    data-accent={accent}
                    aria-hidden="true"
                  />
                  <span>{accent === 'orange' ? 'Orange' : 'Turquoise'}</span>
                  {appearance.accent === accent && (
                    <Check
                      className="appearance-option-check"
                      size={18}
                      aria-hidden="true"
                    />
                  )}
                </button>
              ),
            )}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
