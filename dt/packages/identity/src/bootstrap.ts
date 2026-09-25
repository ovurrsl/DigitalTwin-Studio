import { randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { type DtAuth, resetLinkSink } from './auth'

export class AlreadyBootstrappedError extends Error {
  constructor() {
    super('An admin account already exists; bootstrap is disabled.')
  }
}

export type BootstrapResult = { userId: string; setPasswordUrl: string }

/**
 * Creates the first admin with an unusable random password and returns a one-time
 * link to set the real one (also mailed when mail is configured). Refuses once any
 * admin exists, so it can only ever run on an empty install.
 */
export async function bootstrapAdmin(
  auth: DtAuth,
  pool: Pool,
  admin: { email: string; name: string; username: string },
): Promise<BootstrapResult> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from auth_ba."user" where role = 'admin'`,
  )
  if ((rows[0]?.n ?? 0) > 0) throw new AlreadyBootstrappedError()

  const ctx = await auth.$context
  const email = admin.email.trim().toLowerCase()
  const user = await ctx.internalAdapter.createUser(
    {
      email,
      name: admin.name,
      username: admin.username.toLowerCase(),
      displayUsername: admin.username,
      emailVerified: true,
      role: 'admin',
      status: 'active',
      mustChangePassword: true,
    },
    { method: 'admin' },
  )
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(randomBytes(32).toString('base64url')),
  })

  let setPasswordUrl: string | undefined
  await resetLinkSink.run(
    (url) => {
      setPasswordUrl = url
    },
    () => auth.api.requestPasswordReset({ body: { email, redirectTo: '/welcome' } }),
  )
  if (!setPasswordUrl) throw new Error('Password reset link was not produced.')
  return { userId: user.id, setPasswordUrl }
}
