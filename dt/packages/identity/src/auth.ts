import { AsyncLocalStorage } from 'node:async_hooks'
import { randomInt } from 'node:crypto'
import { sendMail } from '@dt/mail'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { admin, twoFactor, username } from 'better-auth/plugins'
import type { Pool } from 'pg'
import { clearFailures, lockKey, readLock, recordFailure } from './lockout'

/** Panel system roles; custom roles and the action catalogue arrive with @dt/policy. */
export const SYSTEM_ROLES = ['admin', 'supervisor', 'editor', 'viewer', 'address_manager'] as const

const SIGN_IN_PATHS = new Set(['/sign-in/email', '/sign-in/username'])

/** Better Auth's own routes; /api/auth/* belongs to the panel's API contract. */
export const AUTH_BASE_PATH = '/api/ba'

/** Recovery codes in the panel's XXXX-XXXX shape (no 0/O/1/I to keep them legible). */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function generateRecoveryCodes(count = 10): string[] {
  const pick = () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]
  const group = () => Array.from({ length: 4 }, pick).join('')
  return Array.from({ length: count }, () => `${group()}-${group()}`)
}

/** Account status codes the panel distinguishes; `invited` has no password yet. */
const STATUS_ERRORS: Record<string, { code: string; status: 'FORBIDDEN' | 'UNAUTHORIZED' }> = {
  suspended: { code: 'ACCOUNT_SUSPENDED', status: 'FORBIDDEN' },
  inactive: { code: 'ACCOUNT_INACTIVE', status: 'FORBIDDEN' },
  invited: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 'UNAUTHORIZED' },
}

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
    basePath: AUTH_BASE_PATH,
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
      async sendResetPassword({ user, token }) {
        // Panel routes: a first password (new or bootstrapped account) lands on
        // the welcome variant, everything else on the plain reset screen.
        const firstPassword = (user as { mustChangePassword?: boolean }).mustChangePassword === true
        const url = firstPassword
          ? `${baseURL}/welcome?token=${encodeURIComponent(token)}`
          : `${baseURL}/reset/${encodeURIComponent(token)}`
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
      twoFactor({
        issuer: 'DigitalTwin Studio',
        backupCodeOptions: {
          storeBackupCodes: 'encrypted',
          customBackupCodesGenerate: () => generateRecoveryCodes(),
        },
      }),
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
        const blocked = rows[0] && STATUS_ERRORS[rows[0].status]
        if (blocked) {
          throw new APIError(blocked.status, {
            code: blocked.code,
            message: 'This account cannot sign in.',
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
