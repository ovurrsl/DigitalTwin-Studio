import type { EditorProps } from '@pascal-app/editor'
import { createElement, Fragment, type ReactNode } from 'react'

/**
 * The EditorProps slots studio features contribute to. Listing them as keys of
 * EditorProps turns an upstream rename or removal into a type error here instead of
 * a slot that silently stops rendering.
 */
export const NODE_SLOTS = [
  'navbarSlot',
  'viewerToolbarLeft',
  'viewerToolbarRight',
  'stageOverlay',
  'inspectorFooter',
  'multiSelectionFooter',
  'viewerSceneSlot',
  'floorplanSceneSlot',
  'sidebarOverlay',
  'viewerBanner',
] as const satisfies readonly (keyof EditorProps)[]

export type NodeSlot = (typeof NODE_SLOTS)[number]
export type SidebarTabs = NonNullable<EditorProps['sidebarTabs']>

export type EditorSlotContribution = {
  id: string
  slots?: Partial<Record<NodeSlot, ReactNode>>
  sidebarTabs?: SidebarTabs
}

export type ComposedEditorSlots = Partial<Record<NodeSlot, ReactNode>> & {
  sidebarTabs?: SidebarTabs
}

/**
 * Merges contributions in order. Node slots with several contributors render all of
 * them, keyed by contribution id. Sidebar tabs are concatenated, and a later tab with
 * the same id replaces the earlier one in place.
 */
export function composeEditorSlots(contributions: readonly EditorSlotContribution[]) {
  const composed: ComposedEditorSlots = {}
  for (const slot of NODE_SLOTS) {
    const parts = contributions.flatMap((c) =>
      c.slots?.[slot] == null ? [] : [{ id: c.id, node: c.slots[slot] }],
    )
    if (parts.length === 1) composed[slot] = parts[0]?.node
    else if (parts.length > 1)
      composed[slot] = parts.map(({ id, node }) => createElement(Fragment, { key: id }, node))
  }

  const tabs: SidebarTabs = []
  for (const tab of contributions.flatMap((c) => c.sidebarTabs ?? [])) {
    const index = tabs.findIndex((t) => t.id === tab.id)
    if (index === -1) tabs.push(tab)
    else tabs[index] = tab
  }
  if (tabs.length > 0) composed.sidebarTabs = tabs
  return composed
}
