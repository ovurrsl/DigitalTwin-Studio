import { randomUUID } from 'node:crypto'
import { createOTP } from '@better-auth/utils/otp'
import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import type { Pool } from 'pg'
import { type DtAuth, generateRecoveryCodes } from './auth'

/**
 * Starts TOTP enrolment for a signed-in user without re-asking for the password
 * (the panel's setup screen follows sign-in directly). The row is written exactly
 * as Better Auth's enable endpoint writes it (encrypted secret and recovery codes,
 * verified=false), so Better Auth's own verify-totp confirms it and turns 2FA on.
 */
export async function startTotpEnrolment(
  auth: DtAuth,
  pool: Pool,
  user: { id: string; email: string },
): Promise<{ otpauthUri: string }> {
  const ctx = await auth.$context
  const secret = generateRandomString(32)
  const [encryptedSecret, encryptedCodes] = await Promise.all([
    symmetricEncrypt({ key: ctx.secretConfig, data: secret }),
    symmetricEncrypt({ key: ctx.secretConfig, data: JSON.stringify(generateRecoveryCodes()) }),
  ])
  await pool.query(`delete from "twoFactor" where "userId" = $1 and verified is not true`, [
    user.id,
  ])
  await pool.query(
    `insert into "twoFactor" (id, secret, "backupCodes", "userId", verified) values ($1, $2, $3, $4, false)`,
    [randomUUID(), encryptedSecret, encryptedCodes, user.id],
  )
  return {
    otpauthUri: createOTP(secret, { digits: 6, period: 30 }).url('DigitalTwin Studio', user.email),
  }
}

/** The user's unused recovery codes (shown once after enrolment, counted after use). */
export async function readRecoveryCodes(
  auth: DtAuth,
  pool: Pool,
  userId: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ backupCodes: string }>(
    `select "backupCodes" from "twoFactor" where "userId" = $1 limit 1`,
    [userId],
  )
  if (!rows[0]) return []
  const ctx = await auth.$context
  const json = await symmetricDecrypt({ key: ctx.secretConfig, data: rows[0].backupCodes })
  const codes: unknown = JSON.parse(json)
  return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : []
}
