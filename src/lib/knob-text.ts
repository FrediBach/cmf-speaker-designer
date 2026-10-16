import { validatePatternText } from './multicolor-fonts'
import type {
  PatternFontId,
  PatternFontWeight,
} from './multicolor-font-catalog'

/** Reject invalid edits before replacing the last printable character grip. */
export function validateKnobText(
  text: string,
  fontId: PatternFontId,
  fontWeight: PatternFontWeight,
): void {
  if (
    typeof text !== 'string' ||
    Array.from(text).length < 1 ||
    Array.from(text).length > 2 ||
    /[\s\p{C}]/u.test(text)
  )
    throw new Error('Enter one or two visible characters without spaces.')
  validatePatternText(text, fontId, fontWeight)
}
