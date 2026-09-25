import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'
// Generated from apps/editor/next.config.ts by scripts/sync-upstream.mjs.
import upstream from './upstream.next.config'

const dtRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const nextConfig: NextConfig = {
  ...upstream,
  // dt/ is its own install root; upstream's resolveAlias paths ('./node_modules/…')
  // resolve against it unchanged.
  outputFileTracingRoot: dtRoot,
  turbopack: { ...upstream.turbopack, root: dtRoot },
  transpilePackages: [...(upstream.transpilePackages ?? []), '@dt/studio-ux'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // WebXR (VR) needs xr-spatial-tracking for our own origin only.
          {
            key: 'Permissions-Policy',
            value: 'xr-spatial-tracking=(self), camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

export default nextConfig
