import { z } from 'zod'

/** The claims every dbAs() transaction carries; RLS policies read them via dt.current_claims(). */
export const DbClaimsV1 = z.object({
  v: z.literal(1),
  sub: z.string().min(1),
  org: z.string().nullable(),
  caps: z.array(z.string()),
})
export type DbClaimsV1 = z.infer<typeof DbClaimsV1>

export type Subject = {
  kind: 'user' | 'apiKey' | 'shareLink' | 'system'
  id: string
  org: string | null
  caps: readonly string[]
}

export function claimsFor(subject: Subject): DbClaimsV1 {
  return DbClaimsV1.parse({
    v: 1,
    sub: `${subject.kind}:${subject.id}`,
    org: subject.org,
    caps: [...subject.caps],
  })
}
