import type { Design } from './design'

export function downloadDesignJson(design: Design) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(design, null, 2)}\n`], {
      type: 'application/json',
    }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `cmf-speaker-${design.model}-design.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
