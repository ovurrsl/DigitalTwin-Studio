// The studio runs apps/editor's code, so it must install what apps/editor installs.
// Fails when dt/studio/package.json or dt/package.json overrides drift from
// upstream. Workspace deps ("*") must be pinned to the published release instead.
// Run from the repo root; `--write` updates dt/ to match instead of failing
// (dt-lock then refreshes dt/bun.lock on the branch).
import { readFileSync, writeFileSync } from 'node:fs'

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const upstreamApp = read('apps/editor/package.json')
const upstreamRoot = read('package.json')
const studio = read('dt/studio/package.json')
const dtRoot = read('dt/package.json')

const TOOLING_ONLY = new Set(['@pascal/typescript-config', 'typescript'])
const pinned = studio.dependencies['@pascal-app/editor']
const write = process.argv.includes('--write')
const errors = []

for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, spec] of Object.entries(upstreamApp[section] ?? {})) {
    if (TOOLING_ONLY.has(name)) continue
    const ours = studio.dependencies[name] ?? studio.devDependencies?.[name]
    const expected = spec === '*' ? pinned : spec
    if (ours === expected) continue
    if (write)
      (section === 'dependencies' ? studio.dependencies : studio.devDependencies)[name] = expected
    else
      errors.push(
        `${name}: apps/editor wants ${spec}, dt/studio has ${ours ?? 'nothing'} (expected ${expected})`,
      )
  }
}
for (const [name, spec] of Object.entries(upstreamRoot.overrides ?? {})) {
  if (dtRoot.overrides?.[name] === spec) continue
  if (write) dtRoot.overrides = { ...dtRoot.overrides, [name]: spec }
  else
    errors.push(`override ${name}: upstream ${spec}, dt ${dtRoot.overrides?.[name] ?? 'missing'}`)
}

if (write) {
  writeFileSync('dt/studio/package.json', `${JSON.stringify(studio, null, 2)}\n`)
  writeFileSync('dt/package.json', `${JSON.stringify(dtRoot, null, 2)}\n`)
  console.log('Wrote dt/studio/package.json and dt/package.json to match apps/editor.')
  process.exit(0)
}

if (errors.length > 0) {
  for (const e of errors) console.log(`::error::${e}`)
  process.exit(1)
}
console.log('OK: dt/studio dependencies match apps/editor.')
