import { useState } from 'react'

/** Sync external edits before commit without remounting the focused input. */
export function useNumericDraft(value: number, decimalPlaces = 2) {
  const [previousValue, setPreviousValue] = useState(value)
  const [draft, setDraft] = useState(() =>
    String(Number(value.toFixed(decimalPlaces))),
  )

  if (value !== previousValue) {
    setPreviousValue(value)
    setDraft(String(Number(value.toFixed(decimalPlaces))))
  }

  return [draft, setDraft] as const
}
