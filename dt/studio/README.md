# @dt/studio

The DigitalTwin host app: **pascalorg's standalone editor (`apps/editor`) plus our overlay**.

## How the app is assembled

`scripts/sync-upstream.mjs` runs before `dev` and `build`:

| Source | Destination (all gitignored) |
|---|---|
| `apps/editor/{app,components,lib}` (tests skipped) | `studio/{app,components,lib}` |
| `apps/editor/public` | `studio/public` |
| `apps/editor/next.config.ts` | `studio/upstream.next.config.ts`, which our `next.config.ts` extends |
| `styles/elevation.css` and upstream CSS paths | rewritten for `dt/` |
| `studio/overlay/**` | copied last. When a file replaces an upstream one, the upstream file is kept as `upstream-<name>` so ours can wrap it. `overlay/app/layout.tsx`, for example, wraps `upstream-layout.tsx` with the studio shell. |
| `studio/static/**` | `studio/public/**` (our public overrides) |

So `/`, `/scenes`, `/scene/[id]`, `/import` and the rest are exactly upstream's. Every `dt-sync` merge brings upstream's current editor with no copy in git. Our own pages and APIs live only under `overlay/` and `dt/packages`.

## Install root

`dt/` is its own Bun workspace (`dt/package.json`, `dt/bun.lock`, hoisted linker), separate from the upstream workspace at the repo root. Upstream's `bun.lock` stays byte-identical.

```sh
cd dt
bun install
bun run dev          # http://localhost:3100
bun run build        # sync + next build (upstream's ignoreBuildErrors applies to its code)
bun run check-types  # strict type check of our packages
bun run check        # biome (dt/biome.dt.jsonc)
```

## Keeping in step with upstream

- `dt/studio/package.json` must install what `apps/editor` installs. The `@pascal-app/*` workspace deps are pinned to the npm release, and root overrides are mirrored. `dt/scripts/check-upstream-drift.mjs` enforces this in dt-ci; `--write` fixes it.
- `dt/patches/*` mirror upstream `patches/`, enforced by `dt/scripts/check-patches.sh`.
- `dt/bun.lock` is resolved on a runner by the `dt-lock` workflow whenever a `dt/**` manifest changes on a `dt/**` branch.
- The biome config is named `biome.dt.jsonc`. A nested `biome.jsonc` would fail upstream's root `biome check` as a second root config.

## Deployment (Vercel)

The Vercel project is `digitaltwin-studio` in the Revor team, connected to this repository. It targets Hobby plan limits. These settings live on the project, not in git:

| Setting | Value |
|---|---|
| Root Directory | `dt/studio`, with files outside the root directory included, since `sync-public.mjs` reads `apps/editor` |
| Install Command | `cd .. && npx -y bun@1.3.14 install --frozen-lockfile` |
| Build Command | `npx -y bun@1.3.14 run build` |
| Ignored Build Step | skips `upstream-main` and `dependabot/*`, which have no `dt/` tree |
| Env | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Supabase project `digitaltwin-studio`) |

`/api/health` reports whether Supabase is configured and reachable.

## Tracking upstream

- **Upstream source** (`apps/editor/public`, theme, dependency patches): comes from the repo tree and follows every `dt-sync` merge. `dt-ci` fails when `dt/patches/*` drift from upstream's `patches/`.
- **Upstream packages** (`@pascal-app/*`): pinned to an npm release. The daily `dt-upstream-bump` workflow opens a PR whenever pascalorg publishes a newer one, and dt-ci on that PR re-checks the build and the EditorProps slot contract.
