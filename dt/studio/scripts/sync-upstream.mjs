// Builds the studio's app tree from pascalorg/editor's standalone app plus our
// overlay at dev/build time. The studio is the upstream editor with our additions,
// and every upstream sync flows in without upstream code being copied into git.
//
//   apps/editor/{app,components,lib}  -> studio/{app,components,lib}   (tests skipped)
//   apps/editor/public                -> studio/public
//   apps/editor/next.config.ts        -> studio/upstream.next.config.ts
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

// dt/studio/app sits at the same depth as apps/editor/app, so upstream's
// repo-relative @import/@source paths resolve unchanged. Tailwind skips gitignored
// files during automatic source detection, and the synced tree is gitignored here,
// so it is registered explicitly. The panel's scoped tokens are imported after
// upstream's imports (CSS requires @import before other rules).
const globalsPath = path.join(studioDir, 'app/globals.css')
const syncedSources = ['./', '../components', '../lib', '../../packages/panel/src']
  .map((dir) => `@source "${dir}";`)
  .join('\n')
const globals = readFileSync(globalsPath, 'utf8').split('\n')
const lastImport = globals.findLastIndex((line) => line.startsWith('@import '))
globals.splice(lastImport + 1, 0, '@import "../../packages/panel/src/panel.css";')
writeFileSync(globalsPath, `${globals.join('\n')}\n${syncedSources}\n`)

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
