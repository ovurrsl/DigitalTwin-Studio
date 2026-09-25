import { randomUUID } from 'node:crypto'
import { dbAs } from '@dt/db'
import { getAuth } from '@dt/identity'
import { type AccessRequestResponse, accessRequestSchema } from '@panel/lib/api-contract'
import { handler, ok, parseBody } from './http'
import { WORK_DOMAIN } from './settings'

const UNIQUE_VIOLATION = '23505'
const SUBMITTER = { kind: 'system', id: 'access-request', org: null, caps: [] } as const

/**
 * POST /api/requests: files an account request. The answer is the same whether
 * the address already has an account or a pending request, so the form cannot be
 * used to probe for accounts.
 */
export const submitAccessRequest = handler(async (request: Request) => {
  const parsed = await parseBody(request, accessRequestSchema)
  if (!parsed.ok) return parsed.response
  const { fullName, username, department, requestedRole, note } = parsed.data
  const email = `${username}${WORK_DOMAIN}`
  const id = randomUUID()

  const { rows } = await getAuth().pool.query<{ n: number }>(
    `select count(*)::int as n from "user" where lower(email) = $1 or username = $2`,
    [email, username],
  )
  if ((rows[0]?.n ?? 0) === 0) {
    // No ON CONFLICT: its arbiter check needs a SELECT policy, and the submitter
    // must not be able to read the queue. A second pending request is a unique
    // violation, answered like a fresh one.
    await dbAs(
      SUBMITTER,
      (tx) => tx`
        insert into dt.access_requests (id, full_name, email, username, department, requested_role, note)
        values (${id}, ${fullName}, ${email}, ${username}, ${department}, ${requestedRole}, ${note ?? null})
      `,
    ).catch((error: unknown) => {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error
    })
  }
  return ok<AccessRequestResponse>({ request: { id, email, status: 'pending' } }, { status: 201 })
})
