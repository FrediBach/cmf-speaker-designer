import type { SetStateAction } from 'react'
import type { Design } from './design'

export const DESIGN_HISTORY_LIMIT = 100

export type DesignHistory = {
  past: Design[]
  present: Design
  future: Design[]
  transaction: 'idle' | 'pending' | 'recording'
}

export type DesignHistoryAction =
  | { type: 'set'; update: SetStateAction<Design> }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'begin' }
  | { type: 'end' }

function snapshot(design: Design): Design {
  return {
    ...design,
    handle: { ...design.handle },
    grille: { ...design.grille },
    halo: { ...design.halo },
    knob: { ...design.knob },
  }
}

function settingsEqual<T extends object>(left: T, right: T) {
  const keys = Object.keys(left) as (keyof T)[]
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  )
}

function designsEqual(left: Design, right: Design) {
  return (
    left.model === right.model &&
    left.bodyColor === right.bodyColor &&
    left.style === right.style &&
    left.panelColor === right.panelColor &&
    left.knobColor === right.knobColor &&
    left.relief === right.relief &&
    settingsEqual(left.handle, right.handle) &&
    settingsEqual(left.grille, right.grille) &&
    settingsEqual(left.halo, right.halo) &&
    settingsEqual(left.knob, right.knob)
  )
}

function pushSnapshot(past: Design[], design: Design) {
  return [...past, snapshot(design)].slice(-DESIGN_HISTORY_LIMIT)
}

export function createDesignHistory(design: Design): DesignHistory {
  return {
    past: [],
    present: snapshot(design),
    future: [],
    transaction: 'idle',
  }
}

function finishTransaction(state: DesignHistory): DesignHistory {
  if (state.transaction === 'idle') return state
  const baseline = state.past.at(-1)
  return {
    ...state,
    // Moving a slider back to its starting value leaves no undo step.
    past:
      state.transaction === 'recording' &&
      baseline &&
      designsEqual(baseline, state.present)
        ? state.past.slice(0, -1)
        : state.past,
    transaction: 'idle',
  }
}

export function designHistoryReducer(
  state: DesignHistory,
  action: DesignHistoryAction,
): DesignHistory {
  switch (action.type) {
    case 'begin':
      return state.transaction === 'idle'
        ? { ...state, transaction: 'pending' }
        : state
    case 'end':
      return finishTransaction(state)
    case 'set': {
      const next =
        typeof action.update === 'function'
          ? action.update(snapshot(state.present))
          : action.update
      if (designsEqual(state.present, next)) return state
      return {
        past:
          state.transaction === 'recording'
            ? state.past
            : pushSnapshot(state.past, state.present),
        present: snapshot(next),
        future: [],
        transaction: state.transaction === 'idle' ? 'idle' : 'recording',
      }
    }
    case 'undo': {
      const finished = finishTransaction(state)
      const previous = finished.past.at(-1)
      if (!previous) return finished
      return {
        past: finished.past.slice(0, -1),
        present: snapshot(previous),
        future: [snapshot(finished.present), ...finished.future],
        transaction: 'idle',
      }
    }
    case 'redo': {
      const finished = finishTransaction(state)
      const next = finished.future[0]
      if (!next) return finished
      return {
        past: pushSnapshot(finished.past, finished.present),
        present: snapshot(next),
        future: finished.future.slice(1),
        transaction: 'idle',
      }
    }
  }
}
