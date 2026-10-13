import { useState } from 'react'

/** Sync external edits before commit without remounting the focused input. */
export function useNumericDraft(value: number) {
  const [previousValue, setPreviousValue] = useState(value)
  const [draft, setDraft] = useState(() => String(Number(value.toFixed(2))))

  if (value !== previousValue) {
    setPreviousValue(value)
    setDraft(String(Number(value.toFixed(2))))
  }

  return [draft, setDraft] as const
}
