import { getAuth } from '@dt/identity'
import { toNextJsHandler } from 'better-auth/next-js'

export const dynamic = 'force-dynamic'

// Built per request rather than at import so `next build` never needs auth secrets.
const handler = () => toNextJsHandler(getAuth().auth)

export const GET = (request: Request) => handler().GET(request)
export const POST = (request: Request) => handler().POST(request)
