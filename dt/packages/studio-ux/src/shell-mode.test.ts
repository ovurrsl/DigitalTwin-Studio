import { describe, expect, test } from 'bun:test'
import { canTransition, createShellModeStore, SHELL_MODE_TRAITS } from './shell-mode'

describe('shell mode', () => {
  test('only edit is editable', () => {
    const editable = Object.entries(SHELL_MODE_TRAITS)
      .filter(([, t]) => t.editable)
      .map(([m]) => m)
    expect(editable).toEqual(['edit'])
  })

  test('xr and capture cannot chain into each other', () => {
    expect(canTransition('xr', 'capture')).toBe(false)
    expect(canTransition('capture', 'xr')).toBe(false)
    expect(canTransition('edit', 'xr')).toBe(true)
  })

  test('store rejects illegal transitions and notifies only on change', () => {
    const store = createShellModeStore('xr')
    let calls = 0
    store.subscribe(() => calls++)
    expect(store.set('capture')).toBe(false)
    expect(store.get()).toBe('xr')
    expect(store.set('xr')).toBe(true)
    expect(calls).toBe(0)
    expect(store.set('edit')).toBe(true)
    expect(store.get()).toBe('edit')
    expect(calls).toBe(1)
  })
})
