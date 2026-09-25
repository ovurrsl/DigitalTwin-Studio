export const dynamic = 'force-dynamic'

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
  const supabase = await supabaseHealth()
  return Response.json({ ok: true, service: 'dt-studio', supabase })
}
