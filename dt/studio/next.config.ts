import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const studioDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  // dt/ is its own install root; keep Next from resolving the upstream workspace above it.
  outputFileTracingRoot: path.join(studioDir, '..'),
  turbopack: { root: path.join(studioDir, '..') },
  transpilePackages: [
    '@dt/studio-ux',
    'three',
    '@pascal-app/core',
    '@pascal-app/viewer',
    '@pascal-app/editor',
    '@pascal-app/nodes',
  ],
  images: { unoptimized: true },
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
