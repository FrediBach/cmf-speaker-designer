import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN } from './design'
import {
  createDesignHistory,
  designHistoryReducer,
  DESIGN_HISTORY_LIMIT,
  type DesignHistory,
} from './design-history'

const initial = () => createDesignHistory(DEFAULT_DESIGN)
const setRelief = (state: DesignHistory, relief: number) =>
  designHistoryReducer(state, {
    type: 'set',
    update: (design) => ({ ...design, relief }),
  })

describe('design history', () => {
  it('undoes and redoes multiple edits in order, including speaker selection', () => {
    const start = initial()
    const first = setRelief(start, 0.5)
    const second = designHistoryReducer(first, {
      type: 'set',
      update: (design) => ({ ...design, model: 'm' }),
    })
    const third = setRelief(second, 1.5)
    const backTwo = designHistoryReducer(
      designHistoryReducer(third, { type: 'undo' }),
      { type: 'undo' },
    )
    expect(backTwo.present).toEqual(first.present)
    const backAll = designHistoryReducer(backTwo, { type: 'undo' })
    expect(backAll.present).toEqual(start.present)
    expect(designHistoryReducer(backAll, { type: 'undo' })).toBe(backAll)
    const forwardOne = designHistoryReducer(backAll, { type: 'redo' })
    expect(forwardOne.present).toEqual(first.present)
    const forwardTwo = designHistoryReducer(forwardOne, { type: 'redo' })
    expect(forwardTwo.present).toEqual(second.present)
    const forwardAll = designHistoryReducer(forwardTwo, { type: 'redo' })
    expect(forwardAll.present).toEqual(third.present)
    expect(designHistoryReducer(forwardAll, { type: 'redo' })).toBe(forwardAll)
  })

  it('isolates snapshots of every nested setting from external changes', () => {
    const input = structuredClone(DEFAULT_DESIGN)
    const start = createDesignHistory(input)
    input.handle.height = 61
    input.grille.size = 9
    input.halo.depth = 38
    input.knob.height = 23
    expect(start.present).toEqual(DEFAULT_DESIGN)

    const changed = designHistoryReducer(start, { type: 'set', update: input })
    const recorded = structuredClone(changed.present)
    input.handle.height = 62
    input.grille.size = 10
    input.halo.depth = 39
    input.knob.height = 24
    expect(changed.present).toEqual(recorded)
    expect(changed.past[0]).toEqual(DEFAULT_DESIGN)
    expect(changed.past[0].handle).not.toBe(start.present.handle)
    const undone = designHistoryReducer(changed, { type: 'undo' })
    expect(undone.present).toEqual(DEFAULT_DESIGN)
    expect(designHistoryReducer(undone, { type: 'redo' }).present).toEqual(
      recorded,
    )
  })

  it('discards redo only when a new branch changes the design', () => {
    const first = setRelief(initial(), 0.5)
    const second = setRelief(first, 1)
    const undone = designHistoryReducer(second, { type: 'undo' })
    expect(setRelief(undone, 0.5)).toBe(undone)
    const branched = setRelief(undone, 1.5)
    expect(branched.future).toEqual([])
    expect(designHistoryReducer(branched, { type: 'redo' })).toBe(branched)
    expect(designHistoryReducer(branched, { type: 'undo' }).present).toEqual(
      first.present,
    )
  })

  it('ignores equivalent values, including settings with different key order', () => {
    const start = initial()
    const { height, ...otherHandle } = start.present.handle
    const equivalent = {
      ...structuredClone(start.present),
      handle: { ...otherHandle, height },
    }
    expect(
      designHistoryReducer(start, { type: 'set', update: equivalent }),
    ).toBe(start)
    expect(
      designHistoryReducer(start, { type: 'set', update: (design) => design }),
    ).toBe(start)
  })

  it('groups continuous edits from the first change into one undo step', () => {
    const first = setRelief(initial(), 0.25)
    const begun = designHistoryReducer(first, { type: 'begin' })
    expect(begun.past).toHaveLength(1)
    expect(designHistoryReducer(begun, { type: 'begin' })).toBe(begun)
    expect(setRelief(begun, 0.25)).toBe(begun)
    const moved = setRelief(setRelief(setRelief(begun, 0.5), 0.75), 1)
    expect(moved.past).toHaveLength(2)
    const finished = designHistoryReducer(moved, { type: 'end' })
    const undone = designHistoryReducer(finished, { type: 'undo' })
    expect(undone.present).toEqual(first.present)
    expect(designHistoryReducer(undone, { type: 'redo' }).present.relief).toBe(
      1,
    )
    const nextEdit = setRelief(finished, 1.5)
    expect(nextEdit.past).toHaveLength(3)
  })

  it('keeps empty transactions out of history and preserves redo', () => {
    const changed = setRelief(initial(), 1)
    const undone = designHistoryReducer(changed, { type: 'undo' })
    const begun = designHistoryReducer(undone, { type: 'begin' })
    const finished = designHistoryReducer(setRelief(begun, 0), { type: 'end' })
    expect(finished.past).toEqual([])
    expect(finished.future).toEqual(undone.future)
    const roundTrip = setRelief(
      setRelief(designHistoryReducer(initial(), { type: 'begin' }), 1),
      0,
    )
    expect(designHistoryReducer(roundTrip, { type: 'end' }).past).toEqual([])
  })

  it('ends transactions when undo or redo is requested', () => {
    const begun = designHistoryReducer(initial(), { type: 'begin' })
    const moved = setRelief(setRelief(begun, 0.5), 1)
    const undone = designHistoryReducer(moved, { type: 'undo' })
    expect(undone.transaction).toBe('idle')
    expect(undone.present.relief).toBe(0)
    const pending = designHistoryReducer(undone, { type: 'begin' })
    const redone = designHistoryReducer(pending, { type: 'redo' })
    expect(redone.transaction).toBe('idle')
    expect(redone.present.relief).toBe(1)
    const next = setRelief(redone, 1.5)
    expect(next.past).toHaveLength(2)
    expect(designHistoryReducer(begun, { type: 'undo' }).transaction).toBe(
      'idle',
    )
  })

  it('caps retained undo steps at 100', () => {
    let history = initial()
    for (let index = 1; index <= 120; index += 1) {
      history = setRelief(history, index / 100)
    }
    expect(history.past).toHaveLength(DESIGN_HISTORY_LIMIT)
    for (let index = 0; index < DESIGN_HISTORY_LIMIT; index += 1) {
      history = designHistoryReducer(history, { type: 'undo' })
    }
    expect(history.present.relief).toBe(0.2)
    expect(history.future).toHaveLength(DESIGN_HISTORY_LIMIT)
    expect(designHistoryReducer(history, { type: 'undo' })).toBe(history)
    for (let index = 0; index < DESIGN_HISTORY_LIMIT; index += 1) {
      history = designHistoryReducer(history, { type: 'redo' })
    }
    expect(history.present.relief).toBe(1.2)
    expect(history.past).toHaveLength(DESIGN_HISTORY_LIMIT)
  })

  it('can replay reducer updaters without mutating the source state', () => {
    const start = initial()
    const action = {
      type: 'set' as const,
      update: (design: typeof DEFAULT_DESIGN) => ({
        ...design,
        handle: { ...design.handle, height: design.handle.height + 1 },
      }),
    }
    const firstPass = designHistoryReducer(start, action)
    const secondPass = designHistoryReducer(start, action)
    expect(firstPass).toEqual(secondPass)
    expect(firstPass.past).toHaveLength(1)
    expect(start).toEqual(initial())
  })
})
