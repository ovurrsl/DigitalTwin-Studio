'use client'

import { ShellModeProvider, StudioCursor } from '@dt/studio-ux'
import type { ReactNode } from 'react'

export function DtProviders({ children }: { children: ReactNode }) {
  return (
    <ShellModeProvider>
      <StudioCursor>{children}</StudioCursor>
    </ShellModeProvider>
  )
}
