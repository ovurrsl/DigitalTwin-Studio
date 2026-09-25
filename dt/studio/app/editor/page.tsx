'use client'

import { ShellModeProvider, StudioCursor } from '@dt/studio-ux'
import { Editor } from '@pascal-app/editor'

export default function EditorPage() {
  return (
    <ShellModeProvider>
      <StudioCursor>
        <div className="relative h-screen w-screen">
          <Editor layoutVersion="v2" projectId="dt-local" />
        </div>
      </StudioCursor>
    </ShellModeProvider>
  )
}
