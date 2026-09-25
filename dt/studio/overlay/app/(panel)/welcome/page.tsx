import { SetPasswordScreen } from '@panel/components/auth/set-password-screen'
import { getPanelSession, hasPendingSecondFactor } from '@panel/server/session'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * First password, reachable two ways:
 *   /welcome?token=…  a new account opening its emailed (or bootstrap) link
 *   /welcome          a signed-in account that must change its password
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  if (token) return <SetPasswordScreen requestedMode="welcome" token={token} />
  const h = await headers()
  const session = await getPanelSession(h)
  if (!session) redirect(hasPendingSecondFactor(h) ? '/mfa' : '/signin')
  if (!session.user.mustChangePassword) redirect('/console/overview')
  return <SetPasswordScreen identity={session.user.username} requestedMode="welcome" token={null} />
}
