import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { migrate } from './migrate'

const url = process.env.DT_MIGRATOR_DATABASE_URL
if (!url) {
  console.error('DT_MIGRATOR_DATABASE_URL is not set')
  process.exit(1)
}

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
)
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} })
try {
  const { applied, skipped } = await migrate(sql, dir)
  console.log(`applied: ${applied.join(', ') || 'none'}; already applied: ${skipped.length}`)
} finally {
  await sql.end()
}
