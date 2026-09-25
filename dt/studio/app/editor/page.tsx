'use client'

import { Editor } from '@pascal-app/editor'

export default function EditorPage() {
  return (
    <div className="relative h-screen w-screen">
      <Editor layoutVersion="v2" projectId="dt-local" />
    </div>
  )
}
