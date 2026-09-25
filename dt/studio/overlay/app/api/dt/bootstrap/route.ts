import { timingSafeEqual } from 'node:crypto'
import { AlreadyBootstrappedError, bootstrapAdmin, getAuth } from '@dt/identity'

export const dynamic = 'force-dynamic'

function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!(given && expected)) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * One-time creation of the first admin (DT_BOOTSTRAP_ADMIN_EMAIL). Needs the
 * DT_BOOTSTRAP_TOKEN header and refuses once any admin exists; every later account
 * is created from the console.
 */
export async function POST(request: Request) {
  const email = process.env.DT_BOOTSTRAP_ADMIN_EMAIL
  if (
    !(
      email &&
      tokenMatches(request.headers.get('x-dt-bootstrap-token'), process.env.DT_BOOTSTRAP_TOKEN)
    )
  ) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  const { auth, pool } = getAuth()
  try {
    const username = email.split('@')[0]?.replace(/[^a-z0-9_.]/gi, '') || 'admin'
    const result = await bootstrapAdmin(auth, pool, { email, name: username, username })
    return Response.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof AlreadyBootstrappedError) {
      return Response.json({ error: 'already_bootstrapped' }, { status: 409 })
    }
    throw error
  }
}
