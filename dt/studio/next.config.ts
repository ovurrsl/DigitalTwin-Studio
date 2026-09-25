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
}

export default nextConfig
