import { redirect } from 'next/navigation'

// The panel's console tabs are ported in M5; until then its screens' "continue to
// the console" lands in the editor.
export default function ConsolePage() {
  redirect('/')
}
