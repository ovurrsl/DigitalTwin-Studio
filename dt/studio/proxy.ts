import { getSessionCookie } from 'better-auth/cookies'
import { type NextRequest, NextResponse } from 'next/server'

// Reachable without a session. Everything else (the editor, /scenes, the scene
// APIs, the console) redirects to /login; route handlers still check the session
// themselves, since a cookie's presence is not proof of a valid session.
const PUBLIC_PREFIXES = [
  '/login',
  '/reset-password',
  '/api/auth',
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
  const login = new URL('/login', request.url)
  login.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(login)
}

export const config = {
  // Skip Next internals and public files (anything with an extension).
  matcher: ['/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)'],
}
