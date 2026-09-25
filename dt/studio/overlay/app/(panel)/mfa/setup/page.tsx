import { MfaSetupScreen } from '@panel/components/auth/mfa-setup-screen'
import { getPanelSession } from '@panel/server/session'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function MfaSetupPage() {
  if (!(await getPanelSession(await headers()))) redirect('/signin')
  return <MfaSetupScreen />
}
