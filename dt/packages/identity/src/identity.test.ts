import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import path from 'node:path'
import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'
import { migrate } from '@dt/db/migrate'
import { Pool } from 'pg'
import postgres from 'postgres'
import { createDtAuth, type DtAuth } from './auth'
import { AlreadyBootstrappedError, bootstrapAdmin } from './bootstrap'
import { LOCKOUT, recordFailure } from './lockout'
import { readRecoveryCodes, startTotpEnrolment } from './totp'

const adminUrl = process.env.DT_TEST_DATABASE_URL
if (!adminUrl) throw new Error('DT_TEST_DATABASE_URL is required for @dt/identity tests')

const BASE = 'http://localhost:3100'
const migrationsDir = path.resolve(import.meta.dir, '../../../supabase/migrations')
const dbName = `dt_auth_test_${process.pid}_${Date.now()}`
const PASSWORD = 'correct horse battery'

let admin: postgres.Sql
let owner: postgres.Sql
let pool: Pool
let auth: DtAuth

function post(route: string, body: unknown, headers: Record<string, string> = {}) {
  return auth.handler(
    new Request(`${BASE}/api/ba${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, ...headers },
      body: JSON.stringify(body),
    }),
  )
}

const signIn = (email: string, password: string) => post('/sign-in/email', { email, password })

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create database ${dbName}`)
  const ownerUrl = new URL(adminUrl)
  ownerUrl.pathname = `/${dbName}`
  owner = postgres(ownerUrl.toString(), { max: 1, onnotice: () => {} })
  await migrate(owner, migrationsDir)
  await owner.unsafe(`alter role dt_auth login password 'dt_auth_test'`)
  const authUrl = new URL(ownerUrl)
  authUrl.username = 'dt_auth'
  authUrl.password = 'dt_auth_test'
  pool = new Pool({ connectionString: authUrl.toString(), max: 4 })
  auth = createDtAuth({
    pool,
    secret: 'test-secret-'.repeat(4),
    baseURL: BASE,
    trustedOrigins: [BASE],
  })
})

afterAll(async () => {
  await pool?.end()
  await owner?.end()
  await admin?.unsafe(`drop database if exists ${dbName} with (force)`)
  await admin?.end()
})

describe('auth surface', () => {
  test('self sign-up is not exposed', async () => {
    const res = await post('/sign-up/email', {
      email: 'x@example.com',
      password: PASSWORD,
      name: 'X',
    })
    expect(res.status).toBe(404)
  })

  test('dt_auth reaches only auth_ba', async () => {
    await expect(pool.query('select * from dt.user_prefs')).rejects.toThrow(/permission denied/)
  })
})

describe('bootstrap and sign-in', () => {
  let resetUrl: string

  test('creates the first admin once and returns a set-password link', async () => {
    const result = await bootstrapAdmin(auth, pool, {
      email: 'Owner@Example.com',
      name: 'Owner',
      username: 'Owner',
    })
    resetUrl = result.setPasswordUrl
    expect(resetUrl).toContain('/welcome?token=')
    await expect(
      bootstrapAdmin(auth, pool, { email: 'b@example.com', name: 'B', username: 'b' }),
    ).rejects.toBeInstanceOf(AlreadyBootstrappedError)
  })

  test('the link sets the password; email and username sign-in then work', async () => {
    const token = new URL(resetUrl).searchParams.get('token')
    const reset = await post('/reset-password', { newPassword: PASSWORD, token })
    expect(reset.status).toBe(200)
    expect((await signIn('owner@example.com', PASSWORD)).status).toBe(200)
    const byUsername = await post('/sign-in/username', { username: 'owner', password: PASSWORD })
    expect(byUsername.status).toBe(200)
    expect(byUsername.headers.get('set-cookie')).toContain('session_token')
  })
})

describe('lockout ladder', () => {
  test('3 misses lock the account for 30s, even for the right password', async () => {
    for (let i = 0; i < 3; i++)
      expect((await signIn('owner@example.com', 'wrong password!')).status).toBe(401)
    const locked = await signIn('owner@example.com', PASSWORD)
    expect(locked.status).toBe(429)
    const body = (await locked.json()) as { code?: string }
    expect(body.code).toBe('ACCOUNT_LOCKED')
    // Username and email share one counter.
    expect(
      (await post('/sign-in/username', { username: 'owner', password: PASSWORD })).status,
    ).toBe(429)
  })

  test('concurrent failures from separate instances are counted exactly', async () => {
    const other = new Pool({ connectionString: pool.options.connectionString, max: 4 })
    try {
      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          recordFailure(i % 2 ? pool : other, 'user:concurrency'),
        ),
      )
      const { rows } = await pool.query<{ failed: number }>(
        `select failed from dt_login_attempts where key = 'user:concurrency'`,
      )
      expect(rows[0]?.failed).toBe(50)
    } finally {
      await other.end()
    }
  })

  test('the 10th miss locks for 15 minutes', async () => {
    let state = { failed: 0, retryAfterSeconds: 0 }
    for (let i = 0; i < LOCKOUT.hardAfter; i++) state = await recordFailure(pool, 'user:hard')
    expect(state.failed).toBe(10)
    expect(state.retryAfterSeconds).toBeGreaterThan(LOCKOUT.softSeconds)
    expect(state.retryAfterSeconds).toBeLessThanOrEqual(LOCKOUT.hardSeconds)
  })
})

describe('account status', () => {
  test('a suspended account cannot sign in', async () => {
    await pool.query('delete from dt_login_attempts')
    await pool.query(`update "user" set status = 'suspended' where email = 'owner@example.com'`)
    const res = await signIn('owner@example.com', PASSWORD)
    expect(res.status).toBe(403)
    await pool.query(`update "user" set status = 'active' where email = 'owner@example.com'`)
    expect((await signIn('owner@example.com', PASSWORD)).status).toBe(200)
  })
})

describe('two-factor enrolment without re-entering the password', () => {
  const cookieOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')

  test('enrol, confirm with a TOTP code, then recover with a panel-format code', async () => {
    await pool.query('delete from dt_login_attempts')
    const signedIn = await signIn('owner@example.com', PASSWORD)
    expect(signedIn.status).toBe(200)
    const { rows } = await pool.query<{ id: string }>(
      `select id from "user" where email = 'owner@example.com'`,
    )
    const userId = rows[0]?.id as string

    const { otpauthUri } = await startTotpEnrolment(auth, pool, {
      id: userId,
      email: 'owner@example.com',
    })
    const secret = new TextDecoder().decode(
      base32.decode(new URL(otpauthUri).searchParams.get('secret') ?? ''),
    )
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp()
    const confirmed = await post(
      '/two-factor/verify-totp',
      { code },
      { cookie: cookieOf(signedIn) },
    )
    expect(confirmed.status).toBe(200)

    const codes = await readRecoveryCodes(auth, pool, userId)
    expect(codes).toHaveLength(10)
    expect(codes.every((c) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c))).toBe(true)

    const pending = await signIn('owner@example.com', PASSWORD)
    expect(
      ((await pending.clone().json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect,
    ).toBe(true)
    const recovered = await post(
      '/two-factor/verify-backup-code',
      { code: codes[0] },
      { cookie: cookieOf(pending) },
    )
    expect(recovered.status).toBe(200)
    expect(await readRecoveryCodes(auth, pool, userId)).toHaveLength(9)
  })
})
