import { describe, expect, test } from 'bun:test'
import { isValidElement } from 'react'
import { composeEditorSlots } from './editor-slots'

const Empty = () => null

describe('composeEditorSlots', () => {
  test('a single contributor passes its node through', () => {
    const composed = composeEditorSlots([{ id: 'a', slots: { viewerToolbarRight: 'A' } }])
    expect(composed.viewerToolbarRight).toBe('A')
    expect(composed.viewerToolbarLeft).toBeUndefined()
  })

  test('several contributors render all of them, keyed by id', () => {
    const composed = composeEditorSlots([
      { id: 'a', slots: { viewerToolbarRight: 'A' } },
      { id: 'b', slots: { viewerToolbarRight: 'B' } },
    ])
    const nodes = composed.viewerToolbarRight as unknown[]
    expect(nodes).toHaveLength(2)
    expect(nodes.every(isValidElement)).toBe(true)
    expect(nodes.map((n) => (n as { key: string }).key)).toEqual(['a', 'b'])
  })

  test('a later sidebar tab with the same id replaces the earlier one in place', () => {
    const tab = (id: string, label: string) => ({ id, label, component: Empty })
    const composed = composeEditorSlots([
      { id: 'a', sidebarTabs: [tab('site', 'Scene'), tab('items', 'Items')] },
      { id: 'b', sidebarTabs: [tab('site', 'Site'), tab('wh', 'Warehouse')] },
    ])
    expect(composed.sidebarTabs?.map((t) => `${t.id}:${t.label}`)).toEqual([
      'site:Site',
      'items:Items',
      'wh:Warehouse',
    ])
  })
})
