# @dt/studio

The DigitalTwin host app. It consumes the published `@pascal-app/*` packages and
never imports from the upstream tree's source.

## Install root

`dt/` is its own Bun workspace (`dt/package.json`, `dt/bun.lock`, hoisted linker),
separate from the upstream workspace at the repo root. Upstream's `bun.lock` stays
byte-identical.

```sh
cd dt
bun install
bun run dev      # http://localhost:3100
bun run build    # next build, including type check
bun run check    # biome (dt/biome.dt.jsonc)
```

## Upstream-owned inputs

`scripts/sync-public.mjs` runs before `dev` and `build`. It copies inputs that pascalorg/editor owns, so they follow every upstream sync without being committed here:

| Source | Destination (gitignored) |
|---|---|
| `apps/editor/public/` | `studio/public/`. `studio/static/` is copied on top for our own overrides. |
| `apps/editor/app/globals.css` theme tokens | `app/upstream-theme.css` |
| `styles/elevation.css` | `app/upstream-elevation.css` |

Turbopack's root is `dt/`, so files outside it can't be imported directly.

## Notes

- `dt/patches/three@0.186.0.patch` mirrors upstream's `patches/three@0.186.0.patch`, so both installs render identically. When upstream changes its patch, copy it again.
- The biome config is named `biome.dt.jsonc`. A nested `biome.jsonc` would be picked up by upstream's root `biome check` and fail it as a second root config.

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
