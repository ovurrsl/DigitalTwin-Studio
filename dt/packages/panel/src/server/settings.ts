/**
 * The panel's org settings with its documented defaults. The console's Settings
 * tab (M5) moves these into the database; until then an env var can relax MFA.
 */
export type PanelSettings = {
  sessionMinutes: number
  keepSignedInDays: number
  trustedDeviceDays: number
  mfaRequired: boolean
  externalUsersAllowed: boolean
}

export function getSettings(): PanelSettings {
  return {
    sessionMinutes: 20,
    keepSignedInDays: 14,
    trustedDeviceDays: 30,
    mfaRequired: process.env.DT_MFA_REQUIRED !== 'false',
    externalUsersAllowed: true,
  }
}

/** The panel's work address; a bare local part at sign-in resolves against it. */
export const WORK_DOMAIN = '@netlog.com.tr'
