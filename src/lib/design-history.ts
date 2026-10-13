import type { SetStateAction } from 'react'
import type { Design } from './design'
import type { SvgCutout } from './svg-cutout'

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
    handle: {
      ...design.handle,
      svgCutout: design.handle.svgCutout
        ? {
            ...design.handle.svgCutout,
            paths: design.handle.svgCutout.paths.map((path) => ({
              ...path,
              contours: path.contours.map((contour) =>
                contour.map(([x, y]): [number, number] => [x, y]),
              ),
            })),
          }
        : null,
    },
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

function svgCutoutsEqual(left: SvgCutout | null, right: SvgCutout | null) {
  if (left === right) return true
  if (!left || !right) return false
  return (
    left.name === right.name &&
    left.aspectRatio === right.aspectRatio &&
    left.paths.length === right.paths.length &&
    left.paths.every((path, pathIndex) => {
      const otherPath = right.paths[pathIndex]
      return (
        path.fillRule === otherPath.fillRule &&
        path.contours.length === otherPath.contours.length &&
        path.contours.every((contour, contourIndex) => {
          const otherContour = otherPath.contours[contourIndex]
          return (
            contour.length === otherContour.length &&
            contour.every(
              ([x, y], pointIndex) =>
                x === otherContour[pointIndex][0] &&
                y === otherContour[pointIndex][1],
            )
          )
        })
      )
    })
  )
}

function designsEqual(left: Design, right: Design) {
  const { svgCutout: leftSvg, ...leftHandle } = left.handle
  const { svgCutout: rightSvg, ...rightHandle } = right.handle
  return (
    left.model === right.model &&
    left.bodyColor === right.bodyColor &&
    left.style === right.style &&
    left.panelColor === right.panelColor &&
    left.knobColor === right.knobColor &&
    left.relief === right.relief &&
    settingsEqual(leftHandle, rightHandle) &&
    svgCutoutsEqual(leftSvg, rightSvg) &&
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
