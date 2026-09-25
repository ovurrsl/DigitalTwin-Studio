import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'

// Reachable without a session. Everything else (the editor, /scenes, the scene
// APIs, the console) redirects to the panel's /signin; route handlers still check the session
// themselves, since a cookie's presence is not proof of a valid session.
const PUBLIC_PREFIXES = [
  '/signin',
  '/request',
  '/welcome',
  '/reset',
  '/mfa',
  '/api/auth',
  '/api/ba',
  '/api/mfa',
  '/api/requests',
  '/api/health',
  '/api/dt/bootstrap',
  '/terms',
  '/privacy',
]

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    return NextResponse.next()
  if (getSessionCookie(request)) return NextResponse.next()
  if (pathname.startsWith('/api/')) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const signin = new URL('/signin', request.url)
  signin.searchParams.set('redirect', `${pathname}${search}`)
  return NextResponse.redirect(signin)
}

export const config = {
  // Skip Next internals and public files (anything with an extension).
  matcher: ['/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)'],
}
