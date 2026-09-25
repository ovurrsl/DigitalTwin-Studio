import { MfaVerifyScreen } from '@panel/components/auth/mfa-verify-screen'
import { getPanelSession, hasPendingSecondFactor } from '@panel/server/session'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function MfaPage() {
  const h = await headers()
  if (!hasPendingSecondFactor(h)) {
    redirect((await getPanelSession(h)) ? '/console/overview' : '/signin')
  }
  return <MfaVerifyScreen />
}
