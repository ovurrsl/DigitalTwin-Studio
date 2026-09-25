import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import path from 'node:path'
import postgres from 'postgres'
import { dbAs, type Subject } from './index'
import { migrate } from './migrate'

// postgres.js queries are lazy until awaited; `expect().rejects` doesn't await a
// thenable, so rejected-query assertions call `.execute()` first.
// Needs a superuser URL to a throwaway cluster: dt-ci provides a Postgres service,
// locally point it at any disposable instance.
const adminUrl = process.env.DT_TEST_DATABASE_URL
if (!adminUrl) throw new Error('DT_TEST_DATABASE_URL is required for @dt/db tests')

const migrationsDir = path.resolve(import.meta.dir, '../../../supabase/migrations')
const dbName = `dt_test_${process.pid}_${Date.now()}`
const appPassword = 'dt_app_test'

const user = (id: string): Subject => ({ kind: 'user', id, org: null, caps: [] })

let admin: postgres.Sql
let owner: postgres.Sql
let app: postgres.Sql

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create database ${dbName}`)
  // Simulate Supabase's API roles so the revokes in 0001 are exercised.
  await admin.unsafe(`
    do $$ begin
      if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
  `)
  const ownerUrl = new URL(adminUrl)
  ownerUrl.pathname = `/${dbName}`
  owner = postgres(ownerUrl.toString(), { max: 1, onnotice: () => {} })
  await migrate(owner, migrationsDir)
  await owner.unsafe(`alter role dt_app login password '${appPassword}'`)

  const appUrl = new URL(ownerUrl)
  appUrl.username = 'dt_app'
  appUrl.password = appPassword
  // One connection, so a context leak between transactions would be observable.
  app = postgres(appUrl.toString(), { prepare: false, max: 1 })
})

afterAll(async () => {
  await app?.end()
  await owner?.end()
  await admin?.unsafe(`drop database if exists ${dbName} with (force)`)
  await admin?.end()
})

describe('migrate', () => {
  test('is idempotent', async () => {
    const again = await migrate(owner, migrationsDir)
    expect(again.applied).toEqual([])
    expect(again.skipped.length).toBeGreaterThan(0)
  })

  test('rejects an applied migration whose contents changed', async () => {
    await owner`update dt.schema_migrations set checksum = 'tampered' where version = '0001_foundation'`
    await expect(migrate(owner, migrationsDir)).rejects.toThrow(/changed after it was applied/)
    await owner`delete from dt.schema_migrations where version = '0001_foundation'`
    await migrate(owner, migrationsDir)
  })
})

describe('row level security', () => {
  test('without a subject nothing is visible and nothing can be written', async () => {
    await dbAs(
      user('alice'),
      (tx) => tx`insert into dt.user_prefs (user_id) values ('user:alice')`,
      app,
    )
    const rows = await app`select * from dt.user_prefs`
    expect(rows.length).toBe(0)
    await expect(
      app`insert into dt.user_prefs (user_id) values ('user:mallory')`.execute(),
    ).rejects.toThrow(/row-level security/)
  })

  test('a subject sees and writes only its own rows', async () => {
    await dbAs(
      user('bob'),
      (tx) => tx`insert into dt.user_prefs (user_id, locale) values ('user:bob', 'en')`,
      app,
    )
    const bobSees = await dbAs(user('bob'), (tx) => tx`select user_id from dt.user_prefs`, app)
    expect(bobSees.map((r) => r.user_id)).toEqual(['user:bob'])
    await expect(
      dbAs(user('bob'), (tx) => tx`insert into dt.user_prefs (user_id) values ('user:carol')`, app),
    ).rejects.toThrow(/row-level security/)
    const updated = await dbAs(
      user('bob'),
      (tx) => tx`update dt.user_prefs set theme = 'dark' where user_id = 'user:alice'`,
      app,
    )
    expect(updated.count).toBe(0)
  })

  test('the context does not leak to the next transaction on the same connection', async () => {
    await dbAs(user('alice'), (tx) => tx`select 1`, app)
    const [row] = await app`select dt.current_subject() as subject`
    expect(row?.subject).toBeNull()
  })

  test('Supabase API roles and dt_app cannot reach what they should not', async () => {
    await expect(
      owner.begin(async (tx) => {
        await tx`set local role anon`
        return tx`select * from dt.user_prefs`
      }),
    ).rejects.toThrow(/permission denied/)
    await expect(app`select * from auth_ba.nonexistent`.execute()).rejects.toThrow(
      /permission denied|does not exist/,
    )
    const [role] = await owner<
      { bypass: boolean }[]
    >`select rolbypassrls as bypass from pg_roles where rolname = 'dt_app'`
    expect(role?.bypass).toBe(false)
  })
})
