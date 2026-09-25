import { dbAs } from '@dt/db'

export const dynamic = 'force-dynamic'

const HEALTH_SUBJECT = { kind: 'system', id: 'health', org: null, caps: [] } as const

async function databaseHealth() {
  if (!process.env.DT_APP_DATABASE_URL) return { configured: false as const }
  try {
    const [row] = await dbAs(HEALTH_SUBJECT, (tx) => tx`select dt.current_subject() as subject`)
    return { configured: true as const, reachable: row?.subject === 'system:health' }
  } catch (error) {
    return { configured: true as const, reachable: false, error: String(error) }
  }
}

async function supabaseHealth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!(url && key)) return { configured: false as const }
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    return { configured: true as const, reachable: res.ok, status: res.status }
  } catch (error) {
    return { configured: true as const, reachable: false, error: String(error) }
  }
}

export async function GET() {
  const [supabase, database] = await Promise.all([supabaseHealth(), databaseHealth()])
  return Response.json({ ok: true, service: 'dt-studio', supabase, database })
}
