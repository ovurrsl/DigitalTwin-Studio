import postgres from 'postgres'
import { claimsFor, type Subject } from './subject'

export type Tx = postgres.TransactionSql

let appSql: postgres.Sql | undefined

function connectionString(): string {
  const url = process.env.DT_APP_DATABASE_URL
  if (!url) throw new Error('DT_APP_DATABASE_URL is not set')
  return url
}

/** Supavisor's transaction pooler can't hold prepared statements across transactions. */
export function createAppClient(url = connectionString()): postgres.Sql {
  return postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 })
}

function client(): postgres.Sql {
  appSql ??= createAppClient()
  return appSql
}

/**
 * The only application path to the database. Runs `fn` in one transaction whose
 * request context (dt.subject / dt.org / dt.claims) is set transaction-locally, so
 * RLS sees exactly this subject and nothing leaks to the next pooled transaction.
 */
export async function dbAs<T>(
  subject: Subject,
  fn: (tx: Tx) => Promise<T>,
  sql: postgres.Sql = client(),
): Promise<T> {
  const claims = claimsFor(subject)
  const result = await sql.begin(async (tx) => {
    await tx`
      select
        set_config('dt.subject', ${claims.sub}, true),
        set_config('dt.org', ${claims.org ?? ''}, true),
        set_config('dt.claims', ${JSON.stringify(claims)}, true)
    `
    return fn(tx)
  })
  return result as T
}
