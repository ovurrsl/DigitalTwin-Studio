'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'
import {
  createShellModeStore,
  SHELL_MODE_TRAITS,
  type ShellMode,
  type ShellModeStore,
  type ShellModeTraits,
  useShellModeFrom,
} from './shell-mode'

const ShellModeContext = createContext<ShellModeStore | null>(null)

export function ShellModeProvider({
  children,
  initialMode = 'edit',
}: {
  children: ReactNode
  initialMode?: ShellMode
}) {
  const [store] = useState(() => createShellModeStore(initialMode))
  return <ShellModeContext.Provider value={store}>{children}</ShellModeContext.Provider>
}

function useShellModeStore(): ShellModeStore {
  const store = useContext(ShellModeContext)
  if (!store) throw new Error('useShellMode must be used inside <ShellModeProvider>')
  return store
}

export function useShellMode(): {
  mode: ShellMode
  traits: ShellModeTraits
  setMode: (next: ShellMode) => boolean
} {
  const store = useShellModeStore()
  const mode = useShellModeFrom(store)
  return { mode, traits: SHELL_MODE_TRAITS[mode], setMode: store.set }
}
