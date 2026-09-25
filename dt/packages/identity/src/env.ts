import { z } from 'zod'

const AuthEnv = z.object({
  DT_AUTH_DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().optional(),
  VERCEL_ENV: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
})
export type AuthEnv = z.infer<typeof AuthEnv>

/** Fails closed: a missing secret or database URL stops auth rather than running open. */
export function readAuthEnv(source: Record<string, string | undefined> = process.env): AuthEnv {
  return AuthEnv.parse(source)
}

const https = (host: string | undefined) => (host ? `https://${host}` : undefined)

export function resolveOrigins(env: AuthEnv): { baseURL: string; trustedOrigins: string[] } {
  const production =
    env.VERCEL_ENV === 'production' ? https(env.VERCEL_PROJECT_PRODUCTION_URL) : undefined
  const baseURL =
    env.BETTER_AUTH_URL ??
    production ??
    https(env.VERCEL_BRANCH_URL) ??
    https(env.VERCEL_URL) ??
    'http://localhost:3100'
  const trustedOrigins = [baseURL, https(env.VERCEL_URL), https(env.VERCEL_BRANCH_URL), production]
  return { baseURL, trustedOrigins: [...new Set(trustedOrigins.filter((o): o is string => !!o))] }
}
