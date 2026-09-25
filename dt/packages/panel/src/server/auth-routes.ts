import {
  clearFailures,
  getAuth,
  LOCKOUT,
  lockKey,
  readLock,
  readRecoveryCodes,
  startTotpEnrolment,
} from '@dt/identity'
import {
  type MfaRecoveryResponse,
  type MfaSetupResponse,
  type MfaVerifyResponse,
  mfaRecoverySchema,
  mfaVerifySchema,
  type ResetConfirmResponse,
  type ResetRequestResponse,
  resetConfirmSchema,
  resetRequestSchema,
  type SessionResponse,
  type SignInResponse,
  type SignOutResponse,
  signInSchema,
  signOutSchema,
} from '@panel/lib/api-contract'
import { checkPasswordPolicy } from '@panel/lib/password-policy'
import QRCode from 'qrcode'
import { z } from 'zod'
import { fail, handler, ok, parseBody } from './http'
import { forwardCookies, getPanelSession, hasPendingSecondFactor, toSessionUser } from './session'
import { getSettings, WORK_DOMAIN } from './settings'

/**
 * The panel's /api/auth, /api/mfa endpoints — same request and response contract
 * the ported screens were written against — implemented over Better Auth.
 */

type BetterAuthError = { code?: string; retryAfterSeconds?: number }
type SignedInPayload = { user?: Parameters<typeof toSessionUser>[0]; twoFactorRedirect?: boolean }

async function bodyOf<T>(res: Response): Promise<T | null> {
  return (await res
    .clone()
    .json()
    .catch(() => null)) as T | null
}

/** Username, bare local part or full address → the account's email (or a best guess). */
async function resolveEmail(identifier: string): Promise<string> {
  const id = identifier.trim().toLowerCase()
  const { rows } = await getAuth().pool.query<{ email: string }>(
    `select email from "user" where lower(email) = $1 or username = $1 or lower(email) = $2 limit 1`,
    [id, `${id}${WORK_DOMAIN}`],
  )
  return rows[0]?.email ?? (id.includes('@') ? id : `${id}${WORK_DOMAIN}`)
}

async function sessionCount(userId: string): Promise<number> {
  const { rows } = await getAuth().pool.query<{ n: number }>(
    `select count(*)::int as n from "session" where "userId" = $1 and "expiresAt" > now()`,
    [userId],
  )
  return rows[0]?.n ?? 0
}

export const signIn = handler(async (request: Request) => {
  const parsed = await parseBody(request, signInSchema)
  if (!parsed.ok) return parsed.response
  const { identifier, password, keepSignedIn } = parsed.data
  const { auth, pool } = getAuth()
  const email = await resolveEmail(identifier)

  const res = await auth.api.signInEmail({
    body: { email, password, rememberMe: keepSignedIn },
    headers: request.headers,
    asResponse: true,
  })
  if (!res.ok) {
    const err = (await bodyOf<BetterAuthError>(res)) ?? {}
    if (err.code === 'ACCOUNT_LOCKED')
      return fail('account_locked', 'err.locked', {
        retryAfterSeconds: err.retryAfterSeconds ?? 30,
      })
    if (err.code === 'ACCOUNT_SUSPENDED') return fail('account_suspended', 'err.suspended')
    if (err.code === 'ACCOUNT_INACTIVE') return fail('account_inactive', 'err.inactive')
    const lock = await readLock(pool, await lockKey(pool, email))
    if (lock.retryAfterSeconds > 0)
      return fail('account_locked', 'err.locked', { retryAfterSeconds: lock.retryAfterSeconds })
    const threshold = lock.failed >= LOCKOUT.softAfter ? LOCKOUT.hardAfter : LOCKOUT.softAfter
    return fail('invalid_credentials', 'err.credentials', {
      attemptsLeft: Math.max(0, threshold - lock.failed),
    })
  }

  const payload = (await bodyOf<SignedInPayload>(res)) ?? {}
  if (payload.twoFactorRedirect) {
    return forwardCookies(
      res,
      ok<SignInResponse>({ state: 'mfaRequired', pendingLabel: email, enrolmentRequired: false }),
    )
  }
  const user = payload.user ? toSessionUser(payload.user) : undefined
  if (user && getSettings().mfaRequired && user.mfa === 'Off') {
    return forwardCookies(
      res,
      ok<SignInResponse>({ state: 'mfaRequired', pendingLabel: email, enrolmentRequired: true }),
    )
  }
  return forwardCookies(
    res,
    ok<SignInResponse>({ state: user?.mustChangePassword ? 'firstSignIn' : 'signedIn', user }),
  )
})

export const session = handler(async (request: Request) => {
  const { sessionMinutes } = getSettings()
  const current = await getPanelSession(request.headers)
  if (!current) {
    const state = hasPendingSecondFactor(request.headers) ? 'mfaRequired' : 'anonymous'
    return ok<SessionResponse>({ state, user: null, expiresInSeconds: 0, sessionMinutes })
  }
  return ok<SessionResponse>({
    state: current.state,
    user: current.user,
    expiresInSeconds: Math.max(0, Math.floor((current.expiresAt.getTime() - Date.now()) / 1000)),
    sessionMinutes,
  })
})

export const signOut = handler(async (request: Request) => {
  const parsed = await parseBody(request, signOutSchema)
  if (!parsed.ok) return parsed.response
  const { auth } = getAuth()
  const current = await getPanelSession(request.headers)
  if (!current) return ok<SignOutResponse>({ revoked: 0 })
  let revoked = 1
  if (parsed.data.allDevices) {
    revoked = await sessionCount(current.user.id)
    await auth.api.revokeSessions({ headers: request.headers })
  }
  const res = await auth.api.signOut({ headers: request.headers, asResponse: true })
  return forwardCookies(res, ok<SignOutResponse>({ revoked }))
})

const firstPasswordSchema = z
  .object({
    password: z.string().min(10).max(512),
    passwordAgain: z.string().min(10).max(512),
    revokeOtherSessions: z.boolean().default(true),
    acceptPolicy: z.boolean().default(false),
  })
  .refine((v) => v.password === v.passwordAgain, {
    path: ['passwordAgain'],
    params: { code: 'password_mismatch' },
    message: 'err.passwordMismatch',
  })

/** POST /api/auth/password: the first-sign-in password change for a signed-in account. */
export const firstPassword = handler(async (request: Request) => {
  const parsed = await parseBody(request, firstPasswordSchema)
  if (!parsed.ok) return parsed.response
  const current = await getPanelSession(request.headers)
  if (!current) return fail('unauthenticated', 'err.sessionExpired')
  if (!parsed.data.acceptPolicy)
    return fail('validation', 'err.policyRequired', { field: 'acceptPolicy' })
  const policy = checkPasswordPolicy(
    parsed.data.password,
    current.user.username || current.user.email,
  )
  if (!policy.ok) return fail('password_policy', 'err.passwordPolicy', { policy })

  const { auth } = getAuth()
  const ctx = await auth.$context
  await ctx.internalAdapter.updatePassword(
    current.user.id,
    await ctx.password.hash(parsed.data.password),
  )
  await ctx.internalAdapter.updateUser(current.user.id, { mustChangePassword: false })
  let revokedSessions = 0
  if (parsed.data.revokeOtherSessions) {
    revokedSessions = Math.max(0, (await sessionCount(current.user.id)) - 1)
    await auth.api.revokeOtherSessions({ headers: request.headers })
  }
  return ok<ResetConfirmResponse>({
    state: 'signedIn',
    next: current.enrolmentOwed ? 'mfa-setup' : 'console',
    revokedSessions,
  })
})

export const resetRequest = handler(async (request: Request) => {
  const parsed = await parseBody(request, resetRequestSchema)
  if (!parsed.ok) return parsed.response
  const email = parsed.data.email.trim().toLowerCase()
  const { auth, pool } = getAuth()
  const { rows } = await pool.query<{ status: string }>(
    `select status from "user" where lower(email) = $1`,
    [email],
  )
  // Existence is never disclosed: every address gets the same 202.
  if (rows[0] && rows[0].status !== 'suspended' && rows[0].status !== 'inactive') {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset' } })
  }
  return ok<ResetRequestResponse>({ accepted: true }, { status: 202 })
})

type TokenState =
  | {
      state: 'valid'
      userId: string
      email: string
      username: string
      fullName: string
      firstPassword: boolean
      expiresAt: Date
    }
  | { state: 'expired' | 'invalid' }

async function resolveResetToken(token: string): Promise<TokenState> {
  const { rows } = await getAuth().pool.query<{
    userId: string
    expiresAt: Date
    email: string
    username: string | null
    name: string
    mustChangePassword: boolean
  }>(
    `select v.value as "userId", v."expiresAt", u.email, u.username, u.name, u."mustChangePassword"
       from verification v join "user" u on u.id = v.value
      where v.identifier = $1 limit 1`,
    [`reset-password:${token}`],
  )
  const row = rows[0]
  if (!row) return { state: 'invalid' }
  if (row.expiresAt.getTime() < Date.now()) return { state: 'expired' }
  return {
    state: 'valid',
    userId: row.userId,
    email: row.email,
    username: row.username ?? row.email,
    fullName: row.name,
    firstPassword: row.mustChangePassword,
    expiresAt: row.expiresAt,
  }
}

/** GET /api/auth/reset/:token: which variant of the set-password screen to show. */
export const resetPreview = handler(
  async (_request: Request, ctx: { params: Promise<{ token: string }> }) => {
    const token = (await ctx.params).token
    const reset = await resolveResetToken(token)
    if (reset.state === 'expired') return fail('token_expired', 'err.tokenExpired')
    if (reset.state !== 'valid') return fail('token_invalid', 'err.tokenInvalid')
    return reset.firstPassword
      ? ok({
          kind: 'invite' as const,
          email: reset.email,
          fullName: reset.fullName,
          expiresAt: reset.expiresAt.toISOString(),
        })
      : ok({ kind: 'reset' as const, email: reset.email, username: reset.username })
  },
)

export const resetConfirm = handler(async (request: Request) => {
  const parsed = await parseBody(request, resetConfirmSchema)
  if (!parsed.ok) return parsed.response
  const { token, password, acceptPolicy } = parsed.data
  const reset = await resolveResetToken(token)
  if (reset.state === 'expired') return fail('token_expired', 'err.tokenExpired')
  if (reset.state !== 'valid') return fail('token_invalid', 'err.tokenInvalid')
  if (reset.firstPassword && !acceptPolicy)
    return fail('validation', 'err.policyRequired', { field: 'acceptPolicy' })
  const policy = checkPasswordPolicy(password, reset.username || reset.email)
  if (!policy.ok) return fail('password_policy', 'err.passwordPolicy', { policy })

  const { auth, pool } = getAuth()
  const revokedSessions = await sessionCount(reset.userId)
  const res = await auth.api.resetPassword({
    body: { newPassword: password, token },
    asResponse: true,
  })
  if (!res.ok) return fail('token_invalid', 'err.tokenInvalid')
  await pool.query(
    `update "user" set "mustChangePassword" = false,
            status = case when status = 'invited' then 'active' else status end
      where id = $1`,
    [reset.userId],
  )
  await clearFailures(pool, await lockKey(pool, reset.email))
  return ok<ResetConfirmResponse>({ state: 'anonymous', next: 'signin', revokedSessions })
})

function groupKey(otpauthUri: string): string {
  const secret = new URL(otpauthUri).searchParams.get('secret') ?? ''
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret
}

export const mfaSetup = handler(async (request: Request) => {
  const current = await getPanelSession(request.headers)
  if (!current) return fail('unauthenticated', 'err.sessionExpired')
  if (current.user.mfa === 'On') return fail('conflict', 'err.mfaAlreadyEnrolled')
  const { auth, pool } = getAuth()
  const { otpauthUri } = await startTotpEnrolment(auth, pool, {
    id: current.user.id,
    email: current.user.email,
  })
  return ok<MfaSetupResponse>({
    qrDataUrl: await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 }),
    manualKey: groupKey(otpauthUri),
  })
})

function secondFactorFailure(
  err: BetterAuthError | null,
  code: 'mfa_invalid' | 'recovery_invalid',
) {
  if (err?.code?.includes('LOCKED') || err?.code?.includes('TOO_MANY'))
    return fail('account_locked', 'err.locked', { retryAfterSeconds: err.retryAfterSeconds ?? 300 })
  return fail(code, code === 'mfa_invalid' ? 'err.mfaInvalid' : 'err.recoveryInvalid')
}

export const mfaVerify = handler(async (request: Request) => {
  const parsed = await parseBody(request, mfaVerifySchema)
  if (!parsed.ok) return parsed.response
  const { auth, pool } = getAuth()
  const enrolling = await getPanelSession(request.headers)
  if (!enrolling && !hasPendingSecondFactor(request.headers))
    return fail('unauthenticated', 'err.sessionExpired')

  const res = await auth.api.verifyTOTP({
    body: { code: parsed.data.code, trustDevice: parsed.data.trustDevice },
    headers: request.headers,
    asResponse: true,
  })
  if (!res.ok) return secondFactorFailure(await bodyOf<BetterAuthError>(res), 'mfa_invalid')

  const payload = (await bodyOf<SignedInPayload>(res)) ?? {}
  const user = payload.user ? toSessionUser(payload.user) : enrolling?.user
  const recoveryCodes =
    enrolling && enrolling.user.mfa === 'Off'
      ? await readRecoveryCodes(auth, pool, enrolling.user.id)
      : undefined
  return forwardCookies(
    res,
    ok<MfaVerifyResponse>({
      state: user?.mustChangePassword ? 'firstSignIn' : 'signedIn',
      user,
      ...(recoveryCodes ? { recoveryCodes } : {}),
    }),
  )
})

export const mfaRecovery = handler(async (request: Request) => {
  const parsed = await parseBody(request, mfaRecoverySchema)
  if (!parsed.ok) return parsed.response
  if (!hasPendingSecondFactor(request.headers)) return fail('unauthenticated', 'err.sessionExpired')
  const { auth, pool } = getAuth()
  const res = await auth.api.verifyBackupCode({
    body: { code: parsed.data.code },
    headers: request.headers,
    asResponse: true,
  })
  if (!res.ok) return secondFactorFailure(await bodyOf<BetterAuthError>(res), 'recovery_invalid')
  const payload = (await bodyOf<SignedInPayload>(res)) ?? {}
  const user = payload.user ? toSessionUser(payload.user) : undefined
  const codesRemaining = user ? (await readRecoveryCodes(auth, pool, user.id)).length : 0
  return forwardCookies(
    res,
    ok<MfaRecoveryResponse>({
      state: user?.mustChangePassword ? 'firstSignIn' : 'signedIn',
      user,
      codesRemaining,
    }),
  )
})
