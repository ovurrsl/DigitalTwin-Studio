'use client'

import type { ReactNode } from 'react'
import { useShellMode } from './shell-mode-provider'

// Same value upstream uses for the floor-plan panel, so 2D and 3D share one pointer.
export const STUDIO_CURSOR = "url('/cursor.svg') 4 2, default"

const CURSOR_CSS = { studio: STUDIO_CURSOR, system: 'auto', hidden: 'none' } as const

export function StudioCursor({ children }: { children: ReactNode }) {
  const { traits } = useShellMode()
  return (
    <div data-dt-cursor={traits.cursor} style={{ cursor: CURSOR_CSS[traits.cursor] }}>
      {children}
    </div>
  )
}
