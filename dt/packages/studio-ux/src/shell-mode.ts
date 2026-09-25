import { useSyncExternalStore } from 'react'

/**
 * The studio shell's presentation state. One mode at a time drives chrome, cursor
 * and editability, so features ask for traits instead of checking for modes.
 */
export type ShellMode = 'edit' | 'readonly' | 'preview' | 'xr' | 'capture'

export type ShellModeTraits = {
  chrome: 'full' | 'minimal' | 'none'
  cursor: 'studio' | 'system' | 'hidden'
  editable: boolean
}

export const SHELL_MODE_TRAITS: Record<ShellMode, ShellModeTraits> = {
  edit: { chrome: 'full', cursor: 'studio', editable: true },
  readonly: { chrome: 'full', cursor: 'studio', editable: false },
  preview: { chrome: 'minimal', cursor: 'studio', editable: false },
  // The headset renders its own pointer; capture frames must not contain one.
  xr: { chrome: 'none', cursor: 'system', editable: false },
  capture: { chrome: 'none', cursor: 'hidden', editable: false },
}

// xr and capture are entered from and return to a desktop mode, never chained.
const TRANSITIONS: Record<ShellMode, readonly ShellMode[]> = {
  edit: ['readonly', 'preview', 'xr', 'capture'],
  readonly: ['edit', 'preview', 'xr', 'capture'],
  preview: ['edit', 'readonly', 'xr', 'capture'],
  xr: ['edit', 'readonly', 'preview'],
  capture: ['edit', 'readonly', 'preview'],
}

export function canTransition(from: ShellMode, to: ShellMode): boolean {
  return from === to || TRANSITIONS[from].includes(to)
}

export type ShellModeStore = {
  get: () => ShellMode
  set: (next: ShellMode) => boolean
  subscribe: (listener: () => void) => () => void
}

export function createShellModeStore(initial: ShellMode = 'edit'): ShellModeStore {
  let mode = initial
  const listeners = new Set<() => void>()
  return {
    get: () => mode,
    set(next) {
      if (!canTransition(mode, next)) return false
      if (next !== mode) {
        mode = next
        for (const listener of listeners) listener()
      }
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function useShellModeFrom(store: ShellModeStore): ShellMode {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
