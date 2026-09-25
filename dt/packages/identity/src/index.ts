import { Pool } from 'pg'
import { createDtAuth, type DtAuth } from './auth'
import { readAuthEnv, resolveOrigins } from './env'

export { createDtAuth, DISABLED_PATHS, type DtAuth, resetLinkSink, SYSTEM_ROLES } from './auth'
export { AlreadyBootstrappedError, bootstrapAdmin } from './bootstrap'
export { readAuthEnv, resolveOrigins } from './env'
export { LOCKOUT } from './lockout'

let instance: { auth: DtAuth; pool: Pool } | undefined

/**
 * Lazily builds the process-wide auth instance from the environment. dt_auth's
 * role-level search_path is auth_ba, so the transaction pooler needs no session state.
 */
export function getAuth(): { auth: DtAuth; pool: Pool } {
  if (instance) return instance
  const env = readAuthEnv()
  const pool = new Pool({ connectionString: env.DT_AUTH_DATABASE_URL, max: 3 })
  const { baseURL, trustedOrigins } = resolveOrigins(env)
  instance = {
    auth: createDtAuth({ pool, secret: env.BETTER_AUTH_SECRET, baseURL, trustedOrigins }),
    pool,
  }
  return instance
}
