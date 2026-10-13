import { useCallback, useReducer, type SetStateAction } from 'react'
import type { Design } from './design'
import { createDesignHistory, designHistoryReducer } from './design-history'

export function useDesignHistory(initializer: () => Design) {
  const [history, dispatch] = useReducer(
    designHistoryReducer,
    initializer,
    (initialize) => createDesignHistory(initialize()),
  )
  const setDesign = useCallback((update: SetStateAction<Design>) => {
    dispatch({ type: 'set', update })
  }, [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  const beginTransaction = useCallback(() => dispatch({ type: 'begin' }), [])
  const endTransaction = useCallback(() => dispatch({ type: 'end' }), [])

  return {
    design: history.present,
    setDesign,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    beginTransaction,
    endTransaction,
  }
}
