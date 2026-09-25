import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type postgres from 'postgres'

export type MigrationResult = { applied: string[]; skipped: string[] }

type Migration = { version: string; sql: string; checksum: string }

export function readMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(path.join(dir, file), 'utf8')
      return {
        version: file.replace(/\.sql$/, ''),
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      }
    })
}

/**
 * Applies pending migrations in order, each in its own transaction. Migrations are
 * expand-only: an applied file whose contents changed is an error, never re-run.
 */
export async function migrate(sql: postgres.Sql, dir: string): Promise<MigrationResult> {
  await sql`create schema if not exists dt`
  await sql`
    create table if not exists dt.schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `
  const rows = await sql<{ version: string; checksum: string }[]>`
    select version, checksum from dt.schema_migrations
  `
  const applied = new Map(rows.map((r) => [r.version, r.checksum]))
  const result: MigrationResult = { applied: [], skipped: [] }

  for (const m of readMigrations(dir)) {
    const known = applied.get(m.version)
    if (known !== undefined) {
      if (known !== m.checksum) {
        throw new Error(
          `Migration ${m.version} changed after it was applied; add a new migration instead.`,
        )
      }
      result.skipped.push(m.version)
      continue
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(m.sql)
      await tx`insert into dt.schema_migrations (version, checksum) values (${m.version}, ${m.checksum})`
    })
    result.applied.push(m.version)
  }
  return result
}
