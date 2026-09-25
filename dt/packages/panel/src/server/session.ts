import { getAuth } from '@dt/identity'
import type { AuthState, SessionUser, UserStatus } from '@panel/lib/types'
import { roleOf } from './roles'
import { getSettings } from './settings'

type AuthUser = {
  id: string
  name: string
  email: string
  username?: string | null
  role?: string | null
  org?: string | null
  status?: string | null
  twoFactorEnabled?: boolean | null
  mustChangePassword?: boolean | null
}

const STATUS: Record<string, UserStatus> = {
  active: 'Active',
  inactive: 'Inactive',
  invited: 'Invited',
}

export function toSessionUser(user: AuthUser): SessionUser {
  const role = roleOf(user.role)
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username ?? user.email.split('@')[0] ?? user.email,
    role: role.name,
    org: user.org === 'external' ? 'external' : 'internal',
    status: STATUS[user.status ?? 'active'] ?? 'Active',
    mfa: user.twoFactorEnabled ? 'On' : 'Off',
    permissions: role.permissions,
    mustChangePassword: user.mustChangePassword === true,
    siteRoles: {},
  }
}

/** Better Auth marks a half-finished sign-in (password ok, second factor owed) with this cookie. */
export function hasPendingSecondFactor(headers: Headers): boolean {
  return /(?:^|;\s*)(?:__Secure-)?better-auth\.two_factor=/.test(headers.get('cookie') ?? '')
}

export type PanelSession = {
  user: SessionUser
  state: AuthState
  expiresAt: Date
  /** The session exists but the org requires 2FA and this account has not enrolled. */
  enrolmentOwed: boolean
}

export async function getPanelSession(headers: Headers): Promise<PanelSession | null> {
  const found = await getAuth().auth.api.getSession({ headers })
  if (!found) return null
  const user = toSessionUser(found.user as AuthUser)
  const enrolmentOwed = getSettings().mfaRequired && user.mfa === 'Off'
  const state: AuthState = enrolmentOwed
    ? 'mfaRequired'
    : user.mustChangePassword
      ? 'firstSignIn'
      : 'signedIn'
  return { user, state, expiresAt: new Date(found.session.expiresAt), enrolmentOwed }
}

/** Copies Better Auth's Set-Cookie headers onto the panel response. */
export function forwardCookies<T extends Response>(from: Response, to: T): T {
  for (const cookie of from.headers.getSetCookie()) to.headers.append('set-cookie', cookie)
  return to
}
