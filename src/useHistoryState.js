import { useCallback, useState } from 'react'

// A minimal undo/redo stack over a single piece of state. `set` is the
// tracked path (pushes the previous value onto `past`, clears `future`);
// `replaceWithoutHistory` is the escape hatch for updates that shouldn't
// be undoable — the initial load from flow.json, and App's resetLayout
// "nudge" that only exists to re-trigger a memoized effect.
export function useHistoryState(initial) {
  const [state, setState] = useState({ past: [], present: initial, future: [] })

  const set = useCallback((updater) => {
    setState((s) => {
      const next = typeof updater === 'function' ? updater(s.present) : updater
      if (next === s.present) return s
      return { past: [...s.past, s.present], present: next, future: [] }
    })
  }, [])

  const replaceWithoutHistory = useCallback((updater) => {
    setState((s) => ({ ...s, present: typeof updater === 'function' ? updater(s.present) : updater }))
  }, [])

  const undo = useCallback(() => {
    setState((s) => {
      if (s.past.length === 0) return s
      const previous = s.past[s.past.length - 1]
      return { past: s.past.slice(0, -1), present: previous, future: [s.present, ...s.future] }
    })
  }, [])

  const redo = useCallback(() => {
    setState((s) => {
      if (s.future.length === 0) return s
      const [next, ...rest] = s.future
      return { past: [...s.past, s.present], present: next, future: rest }
    })
  }, [])

  return {
    value: state.present,
    set,
    replaceWithoutHistory,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
