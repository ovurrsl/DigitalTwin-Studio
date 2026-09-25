# @dt/studio

The DigitalTwin host app: **pascalorg's standalone editor (`apps/editor`) on pascalorg's own workspace, plus our overlay.**

## What comes from upstream

Everything that makes up the editor comes from the checked-out pascalorg/editor tree (our `main` mirrors pascalorg `main`):

- **Packages.** `@pascal-app/core`, `viewer`, `editor`, `nodes` and `mcp` are built from `packages/*` source by upstream's own turbo pipeline, not taken from npm.
- **Dependencies.** Plugins, React, three and Next, with upstream's patches, come from the root `bun install --frozen-lockfile` against upstream's unmodified `bun.lock`.
- **App code.** `scripts/sync-upstream.mjs` runs before `dev` and `build` and assembles the app:

| Source | Destination (gitignored) |
|---|---|
| `apps/editor/{app,components,lib}` (tests skipped) | `studio/{app,components,lib}` |
| `apps/editor/public` | `studio/public` |
| `apps/editor/next.config.ts` | `studio/upstream.next.config.ts`. Our `next.config.ts` extends it and only adds headers and our packages. |
| `studio/overlay/**` | copied last. A replaced upstream module is kept as `upstream-<name>` so we wrap it rather than fork it. For example, `overlay/app/layout.tsx` wraps `upstream-layout.tsx` with the studio shell. |
| `studio/static/**` | `studio/public/**` (our public overrides) |

`dt/studio/app` sits at the same depth as `apps/editor/app`, so upstream's CSS paths resolve unchanged. The synced tree is gitignored, so it is registered with Tailwind as explicit `@source` entries.

Node resolution walks up from `dt/` to the repo root's `node_modules`. `dt/bunfig.toml` sets `peer = false`, so `dt/node_modules` only holds our own dependencies and never a second React or three.

## Commands

```sh
# once per checkout: upstream workspace
bun install --frozen-lockfile
bun run build --filter='editor^...'

# our layer
cd dt
bun install
bun run dev          # http://localhost:3100
bun run build        # sync + next build (upstream's ignoreBuildErrors applies to its code)
bun run check-types  # strict type check of dt/packages
bun run check        # biome (dt/biome.dt.jsonc)
bun run test         # studio-ux
bun run test:db      # needs DT_TEST_DATABASE_URL (a disposable Postgres superuser URL)
```

The biome config is named `biome.dt.jsonc`. A nested `biome.jsonc` would fail upstream's root `biome check` as a second root config.

## Deployment (Vercel)

The Vercel project is `digitaltwin-studio` in the Revor team, on the Hobby plan. These settings live on the project, not in git:

| Setting | Value |
|---|---|
| Root Directory | `dt/studio`, with files outside the root directory included |
| Install Command | `cd ../.. && npx -y bun@1.3.14 install --frozen-lockfile && cd dt && npx -y bun@1.3.14 install --frozen-lockfile` |
| Build Command | `cd ../.. && npx -y bun@1.3.14 run build --filter='editor^...' && cd dt/studio && npx -y bun@1.3.14 run build` |
| Ignored Build Step | skips `upstream-main` and `dependabot/*`, which have no `dt/` tree |
| Env | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DT_APP_DATABASE_URL` (sensitive) |

`/api/health` reports Supabase and database reachability.
