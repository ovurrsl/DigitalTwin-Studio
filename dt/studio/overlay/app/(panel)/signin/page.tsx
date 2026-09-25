import { SignInScreen } from '@panel/components/auth/sign-in-screen'
import { getPanelSession } from '@panel/server/session'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export default async function SignInPage() {
  // An already signed-in visitor goes to the console instead of re-authenticating.
  const session = await getPanelSession(await headers())
  if (session?.state === 'signedIn') redirect('/console/overview')
  return (
    <Suspense fallback={null}>
      <SignInScreen />
    </Suspense>
  )
}
