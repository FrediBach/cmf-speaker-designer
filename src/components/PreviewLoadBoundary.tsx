import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/** Keep the editor usable when the separately loaded preview cannot start. */
export class PreviewLoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div
        className="preview-loading"
        role="alert"
        style={{ padding: 24, textAlign: 'center' }}
      >
        <strong style={{ color: 'var(--foreground)', fontWeight: 500 }}>
          Preview could not load
        </strong>
        <p style={{ maxWidth: 300, lineHeight: 1.6 }}>
          You can still customize and download your design. Reload the page to
          try the 3D preview again.
        </p>
        {/* React.lazy caches a rejected import. Reload to fetch the current build. */}
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
    )
  }
}
