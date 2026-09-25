import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'
// Generated from apps/editor/next.config.ts by scripts/sync-upstream.mjs.
import upstream from './upstream.next.config'

// The studio runs on the upstream workspace install at the repo root (built
// @pascal-app/* packages, plugins, patched three), exactly like apps/editor.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

const nextConfig: NextConfig = {
  ...upstream,
  outputFileTracingRoot: repoRoot,
  turbopack: { ...upstream.turbopack, root: repoRoot },
  transpilePackages: [...(upstream.transpilePackages ?? []), '@dt/studio-ux', '@dt/db'],
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
