import { useLayoutEffect, useState } from 'react'

export type Appearance = {
  theme: 'light' | 'dark'
  accent: 'orange' | 'turquoise'
}

export const APPEARANCE_STORAGE_KEY = 'cmf-speaker-appearance-v1'
export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'light',
  accent: 'orange',
}

export function readAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    const value: unknown = saved ? JSON.parse(saved) : null
    if (value && typeof value === 'object') {
      const data = value as Partial<Appearance>
      return {
        theme: data.theme === 'dark' ? 'dark' : 'light',
        accent: data.accent === 'turquoise' ? 'turquoise' : 'orange',
      }
    }
  } catch {
    // Invalid saved preferences or blocked storage use the defaults.
  }
  return { ...DEFAULT_APPEARANCE }
}

export function applyAppearance(appearance: Appearance) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = appearance.theme
  document.documentElement.dataset.accent = appearance.accent
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      'content',
      getComputedStyle(document.documentElement)
        .getPropertyValue('--background')
        .trim(),
    )
}

export function useAppearance() {
  const [appearance, setAppearance] = useState(readAppearance)

  useLayoutEffect(() => {
    applyAppearance(appearance)
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance))
    } catch {
      // Appearance still works for this visit when storage is unavailable.
    }
  }, [appearance])

  return [appearance, setAppearance] as const
}
