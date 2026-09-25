import type { Pool } from 'pg'

/**
 * The panel's sign-in lockout ladder: a short lock after 3 misses, a long one
 * after 10. The counter is kept in one row per account and moved by a single
 * upsert, so concurrent attempts on different instances are counted exactly.
 */
export const LOCKOUT = {
  softAfter: 3,
  softSeconds: 30,
  hardAfter: 10,
  hardSeconds: 15 * 60,
} as const

export type LockState = { failed: number; retryAfterSeconds: number }

/** Accounts are keyed by user id when the identifier resolves, so email and username share one counter. */
export async function lockKey(pool: Pool, identifier: string): Promise<string> {
  const normalized = identifier.trim().toLowerCase()
  const { rows } = await pool.query<{ id: string }>(
    'select id from auth_ba."user" where lower(email) = $1 or username = $1 limit 1',
    [normalized],
  )
  return rows[0] ? `user:${rows[0].id}` : `identifier:${normalized}`
}

export async function readLock(pool: Pool, key: string): Promise<LockState> {
  const { rows } = await pool.query<{ failed: number; retry: number }>(
    `select failed,
            greatest(0, ceil(extract(epoch from locked_until - now())))::int as retry
       from auth_ba.dt_login_attempts where key = $1`,
    [key],
  )
  return { failed: rows[0]?.failed ?? 0, retryAfterSeconds: rows[0]?.retry ?? 0 }
}

export async function recordFailure(pool: Pool, key: string): Promise<LockState> {
  const { rows } = await pool.query<{ failed: number; retry: number }>(
    `insert into auth_ba.dt_login_attempts as t (key, failed, locked_until, updated_at)
     values ($1, 1, null, now())
     on conflict (key) do update set
       failed = t.failed + 1,
       locked_until = case
         when t.failed + 1 >= $2 then now() + make_interval(secs => $3)
         when t.failed + 1 >= $4 then now() + make_interval(secs => $5)
         else t.locked_until
       end,
       updated_at = now()
     returning failed, greatest(0, ceil(extract(epoch from locked_until - now())))::int as retry`,
    [key, LOCKOUT.hardAfter, LOCKOUT.hardSeconds, LOCKOUT.softAfter, LOCKOUT.softSeconds],
  )
  const row = rows[0]
  return { failed: row?.failed ?? 1, retryAfterSeconds: row?.retry ?? 0 }
}

export async function clearFailures(pool: Pool, key: string): Promise<void> {
  await pool.query('delete from auth_ba.dt_login_attempts where key = $1', [key])
}
