// Builds the studio's app tree from pascalorg/editor's standalone app plus our
// overlay at dev/build time. The studio is the upstream editor with our additions,
// and every upstream sync flows in without upstream code being copied into git.
//
//   apps/editor/{app,components,lib}  -> studio/{app,components,lib}   (tests skipped)
//   apps/editor/public                -> studio/public
//   apps/editor/next.config.ts        -> studio/upstream.next.config.ts
//   styles/elevation.css              -> studio/app/upstream-elevation.css
//   studio/overlay/**                 -> studio/**         (copied last; our files win)
//   studio/static/**                  -> studio/public/**  (our public overrides)
//
// When an overlay file replaces an upstream module, the upstream one is kept next
// to it as `upstream-<name>` so ours can wrap it instead of forking it.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const studioDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(studioDir, '../..')
const upstreamApp = path.join(repoRoot, 'apps/editor')
const overlayDir = path.join(studioDir, 'overlay')

for (const entry of ['app', 'components', 'lib', 'public', 'upstream.next.config.ts']) {
  rmSync(path.join(studioDir, entry), { recursive: true, force: true })
}

const skipTests = (src) => !/\.test\.tsx?$/.test(src)
for (const dir of ['app', 'components', 'lib']) {
  cpSync(path.join(upstreamApp, dir), path.join(studioDir, dir), {
    recursive: true,
    filter: skipTests,
  })
}
cpSync(path.join(upstreamApp, 'public'), path.join(studioDir, 'public'), { recursive: true })
cpSync(path.join(upstreamApp, 'next.config.ts'), path.join(studioDir, 'upstream.next.config.ts'))
cpSync(
  path.join(repoRoot, 'styles/elevation.css'),
  path.join(studioDir, 'app/upstream-elevation.css'),
)

// Turbopack's root is dt/, so upstream's repo-relative CSS paths are rewritten to
// the same sources inside dt/node_modules.
const globalsPath = path.join(studioDir, 'app/globals.css')
const globals = readFileSync(globalsPath, 'utf8')
  .replace('@import "../../../styles/elevation.css";', '@import "./upstream-elevation.css";')
  .replace(
    /@source "\.\.\/\.\.\/\.\.\/packages\/([^/"]+)\/src";/g,
    '@source "../../node_modules/@pascal-app/$1/src";',
  )
  .replace(/@source "\.\.\/\.\.\/\.\.\/node_modules\//g, '@source "../../node_modules/')
writeFileSync(globalsPath, globals)

function overlay(from, to) {
  for (const name of readdirSync(from)) {
    const src = path.join(from, name)
    const dest = path.join(to, name)
    if (statSync(src).isDirectory()) {
      mkdirSync(dest, { recursive: true })
      overlay(src, dest)
      continue
    }
    if (existsSync(dest)) renameSync(dest, path.join(to, `upstream-${name}`))
    cpSync(src, dest)
  }
}
if (existsSync(overlayDir)) overlay(overlayDir, studioDir)

const staticDir = path.join(studioDir, 'static')
if (existsSync(staticDir)) cpSync(staticDir, path.join(studioDir, 'public'), { recursive: true })

console.log('[dt] studio synced from apps/editor + overlay')
