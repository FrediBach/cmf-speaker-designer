import { useEffect, useRef, type HTMLAttributes } from 'react'
import type { useDesignHistory } from './use-design-history'

type History = ReturnType<typeof useDesignHistory>

export function useDesignInteractions(
  { canUndo, canRedo, undo, redo, beginTransaction, endTransaction }: History,
  setToast: (message: string) => void,
) {
  const historyGesture = useRef<'pointer' | 'keyboard' | null>(null)
  useEffect(() => {
    const finishGesture = () => {
      if (!historyGesture.current) return
      historyGesture.current = null
      endTransaction()
    }
    const finishPointer = () => {
      if (historyGesture.current === 'pointer') finishGesture()
    }
    const finishKey = (event: KeyboardEvent) => {
      if (
        historyGesture.current === 'keyboard' &&
        /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(event.key)
      )
        finishGesture()
    }
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            (target instanceof HTMLInputElement &&
              !['checkbox', 'radio', 'range', 'color'].includes(target.type)) ||
            target.closest(
              'textarea, select, [role="textbox"], [role="dialog"], [role="alertdialog"]',
            )))
      )
        return
      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo =
        (key === 'z' && event.shiftKey) ||
        (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey)
      if (!isUndo && !isRedo) return
      event.preventDefault()
      finishGesture()
      if (isUndo && canUndo) {
        undo()
        setToast('Design change undone.')
      } else if (isRedo && canRedo) {
        redo()
        setToast('Design change redone.')
      }
    }
    window.addEventListener('keydown', handleShortcut)
    window.addEventListener('keyup', finishKey)
    window.addEventListener('pointerup', finishPointer)
    window.addEventListener('pointercancel', finishPointer)
    window.addEventListener('blur', finishGesture)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
      window.removeEventListener('keyup', finishKey)
      window.removeEventListener('pointerup', finishPointer)
      window.removeEventListener('pointercancel', finishPointer)
      window.removeEventListener('blur', finishGesture)
    }
  }, [canUndo, canRedo, undo, redo, endTransaction, setToast])

  const handlers: Pick<
    HTMLAttributes<HTMLElement>,
    'onPointerDownCapture' | 'onKeyDownCapture' | 'onFocusCapture' | 'onBlur'
  > = {
    onPointerDownCapture: (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-slot="slider"]')
      ) {
        // Commit a numeric draft before starting the slider's undo step.
        if (document.activeElement instanceof HTMLInputElement)
          document.activeElement.blur()
        endTransaction()
        beginTransaction()
        historyGesture.current = 'pointer'
      }
    },
    onKeyDownCapture: (event) => {
      if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.target instanceof Element &&
        event.target.closest('[role="slider"]') &&
        /^(Arrow(Left|Right|Up|Down)|Home|End|PageUp|PageDown)$/.test(
          event.key,
        ) &&
        historyGesture.current !== 'keyboard'
      ) {
        endTransaction()
        beginTransaction()
        historyGesture.current = 'keyboard'
      }
    },
    onFocusCapture: (event) => {
      if (
        event.target instanceof HTMLInputElement &&
        ['number', 'text', 'color'].includes(event.target.type)
      )
        beginTransaction()
    },
    onBlur: (event) => {
      if (
        event.target instanceof HTMLInputElement &&
        historyGesture.current !== 'pointer'
      )
        endTransaction()
    },
  }
  return handlers
}
