import { AsyncLocalStorage } from 'node:async_hooks'
import { sendMail } from '@dt/mail'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { admin, twoFactor, username } from 'better-auth/plugins'
import type { Pool } from 'pg'
import { clearFailures, lockKey, readLock, recordFailure } from './lockout'

/** Panel system roles; custom roles and the action catalogue arrive with @dt/policy. */
export const SYSTEM_ROLES = ['admin', 'supervisor', 'editor', 'viewer', 'address_manager'] as const

const SIGN_IN_PATHS = new Set(['/sign-in/email', '/sign-in/username'])

/** Routes never exposed: accounts are created from the console, and there is no social login. */
export const DISABLED_PATHS = [
  '/sign-up/email',
  '/sign-in/social',
  '/link-social',
  '/unlink-account',
  '/delete-user',
  '/change-email',
]

/** Lets a caller (bootstrap, console invites) receive the reset link it just triggered. */
export const resetLinkSink = new AsyncLocalStorage<(url: string) => void>()

export type DtAuthOptions = {
  pool: Pool
  secret: string
  baseURL: string
  trustedOrigins: string[]
}

function signInIdentifier(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const { email, username: name } = body as { email?: unknown; username?: unknown }
  const value = typeof email === 'string' ? email : typeof name === 'string' ? name : undefined
  return value?.trim() || undefined
}

export function createDtAuth({ pool, secret, baseURL, trustedOrigins }: DtAuthOptions) {
  return betterAuth({
    appName: 'DigitalTwin Studio',
    database: pool,
    secret,
    baseURL,
    trustedOrigins,
    disabledPaths: DISABLED_PATHS,
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60 * 24,
      async sendResetPassword({ user, url }) {
        resetLinkSink.getStore()?.(url)
        await sendMail({
          to: user.email,
          subject: 'DigitalTwin Studio: şifre belirleme / Set your password',
          text: `Şifrenizi belirlemek için / To set your password:\n${url}\n\nBu bağlantı 24 saat geçerlidir. / This link is valid for 24 hours.`,
        })
      },
    },
    user: {
      additionalFields: {
        status: { type: 'string', defaultValue: 'active', input: false },
        org: { type: 'string', defaultValue: 'internal', input: false },
        locale: { type: 'string', defaultValue: 'tr', input: true },
        mustChangePassword: { type: 'boolean', defaultValue: false, input: false },
      },
    },
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 64 }),
      twoFactor({ issuer: 'DigitalTwin Studio' }),
      admin({ defaultRole: 'viewer', adminRoles: ['admin'] }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!SIGN_IN_PATHS.has(ctx.path)) return
        const identifier = signInIdentifier(ctx.body)
        if (!identifier) return
        const key = await lockKey(pool, identifier)
        const lock = await readLock(pool, key)
        if (lock.retryAfterSeconds > 0) {
          throw new APIError('TOO_MANY_REQUESTS', {
            code: 'ACCOUNT_LOCKED',
            message: `Too many failed attempts. Try again in ${lock.retryAfterSeconds}s.`,
            retryAfterSeconds: lock.retryAfterSeconds,
          })
        }
        const { rows } = await pool.query<{ status: string }>(
          'select status from auth_ba."user" where lower(email) = $1 or username = $1 limit 1',
          [identifier.toLowerCase()],
        )
        if (rows[0] && rows[0].status !== 'active') {
          throw new APIError('FORBIDDEN', {
            code: 'ACCOUNT_INACTIVE',
            message: 'This account is not active.',
          })
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!SIGN_IN_PATHS.has(ctx.path)) return
        const identifier = signInIdentifier(ctx.body)
        if (!identifier) return
        const returned = ctx.context.returned
        const key = await lockKey(pool, identifier)
        if (isAPIError(returned)) {
          if (returned.status === 'UNAUTHORIZED') await recordFailure(pool, key)
          return
        }
        await clearFailures(pool, key)
      }),
    },
  })
}

export type DtAuth = ReturnType<typeof createDtAuth>
