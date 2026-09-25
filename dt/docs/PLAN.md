# DigitalTwin-Studio: integrated design plan (v2)

## Context
The user rejected v1 because it ported old-system features 1:1. v2 comes from a design pass:

- an inventory of 139 features and how each depends on, shares data with, or conflicts with the others;
- 7 domain architects, each checked by an adversarial critic and revised;
- one synthesis.

The detailed design, with upstream file:line anchors, is in `dt/docs/DESIGN.md`.

Hard constraints:
- **Repo.** `ovurrsl/DigitalTwin-Studio` is private and not a fork. The pascalorg/editor tree stays byte-identical, including `bun.lock`, so upstream merges never conflict.
- **Infrastructure.** Vercel plus a NEW Supabase project, starting with fresh data. The live Digitaltwin MySQL is never touched.
- **Identity.** Better Auth is the only identity system; every panel feature is kept.
- **Console.** Lives at `/console`.
- **XR.** VR only.
- **Presentation mode.** Uses the demo-listing-bordeaux display type, is role-gated, and is controlled from the console.
- **Upstream PRs.** The 15 items the user selected go to pascalorg/editor as PRs.
- **Never modify:** pascalorg/editor, panel `main`, plugin-warehouse `main`, ovurrsl/Digitaltwin, or the ovurrsl/editor branches `main`, `integration`, `Performance` and `claude/editor-branch-sync-mfwna9`. PR #49 stays as it is.

## Core idea: shared foundations instead of per-feature hacks
Every write takes the same path. Editor autosave, MCP tool calls, console edits, warehouse commands, Excel/IFC import, restore and publish all go through:

1. `@dt/scene.commit()`
2. `@dt/policy.decide()` (with lease epoch, category lock and field allowlist)
3. field-level merge
4. registry-aware validation and a server-side wipe guard
5. transaction hooks (warehouse projection, complexity)
6. `@dt/events` outbox
7. after commit: a content-free `@dt/signal` ping

| Foundation | Replaces (old system) |
|---|---|
| F1 **Repo, artifacts and patches.** All our code lives under `dt/`, which has its own install root and `dt/bun.lock`. Upstream packages are packed by CI as `@ovurrsl/pascal-*@1.0.3-dt.<sha>.<patchset>` and aliased to `@pascal-app/*`. `@dt/compat` holds every patch/probe flag. The patch count starts at 6 or fewer and falls to 3 or fewer. | 257 edited upstream files, UPSTREAM.md conflict rules, hourly pin commits |
| F2 **`@dt/db`.** `dbAs(subject)` is the only DB path. Roles are `dt_app` (NOBYPASSRLS), `dt_auth` and `dt_migrator`. RLS is FORCE and fail-closed. Migrations are expand-only. | `USING(true)` RLS, service-role everywhere, MySQL/SQLite hybrids |
| F3 **`@dt/scene` + `@dt/scene-client`.** Snapshot plus op log with a (nodeId, key) merge, epoch-fenced edit leases, hash-named revisions, `DtSceneStore implements SceneStore` (shared with MCP), and an IndexedDB write-ahead journal. `json_docs` holds presentation, env and tour documents. | SQLite/MySQL stores, 423 presence guard, share rows, an unused Yjs setup |
| F4 **`@dt/policy` + `@dt/identity`.** `decide(subject, action, resource)` returns an answer, reasons, and obligations (redaction, read-only categories, step-up). Subjects are user, API key, share link, anonymous, system and impersonation. The action catalogue covers scene, presentation, MCP, warehouse, asset and console. Better Auth plugins used: username, twoFactor, admin, magic link. There is no public sign-up and no social login; accounts are managed from the console. Revocation is epoch-based. | custom argon2/dt_session, reverted requireSitePermission, UI-only API keys, bypass flags |
| F5 **`@dt/events` + `@dt/runtime`.** One `dt_events` outbox with consumer cursors feeds `dt_jobs`. A tick runs through `after()`, plus pg_cron + pg_net calling the HMAC `/api/internal/tick` every 30 s. Audit and logs are views over events. Webhooks follow Standard-Webhooks. | setInterval workers, UI-only webhooks, a separate audit table |
| F6 **`@dt/signal`.** Supabase Realtime broadcast with content-free pings on HMAC topics; data is always fetched through authenticated routes. Presence is included; polling is the fallback. | 5 separate realtime mechanisms, SSE bounded by maxDuration |
| F7 **`@dt/assets`.** Intent, then signed PUT, then verify job, then content-addressed storage. Downloads use `/a/:id` returning a 302 to a signed URL; there are 4 private buckets. Inline bodies are capped at 1 MB for ops and 3.5 MB gzipped for commits. | public buckets, 20 MB GLBs through functions, 29 MB JSON in public/ |
| F8 **`@dt/studio-ux`.** A single adapter over the EditorProps slots (with a contract test), a ShellMode state machine (edit / readonly / preview / xr / capture) driving chrome, cursor, audio and tour, a capability-filtered command catalogue, and a CaptureService. | slot/string edits, timer-based tour, global cursor override |
| F9 **`@dt/i18n` (EN/TR ICU), `--color-dt-*` scoped theme, `@dt/mail`.** | |
| F10 **Contract suite.** Tests every upstream public API we use: SceneStore, createPascalMcpServer, applySceneOperationPatch, acquireSceneReadOnlyLease, the registry, EditorProps slots, registerViewerPresentation, and so on. It runs on every upstream sync PR. | silent API drift |

## Domain designs (beyond the old system)
- **Warehouse.**
  - A serverless-safe `/model` kernel shared by the plugin, console, MCP tools and presentation facts.
  - Slot keys are derived from node ids, and the slot projection is written in the same commit transaction.
  - A typed command algebra whose `plan()` emits a NodeDelta.
  - Vertical-opening normalizers also run on the server.
  - The untyped BroadcastChannel bridge is deleted: console relabels become `scene.patch.fields` commits.
  - Plugin work is on the branch `digitaltwin/upstream-1.0-compat`: tsup subpath exports, an icon sprite, `hostRefFields`, single-token id prefixes, an `isValidPosition` guard, and a "Large hall" action. It ships as GitHub Packages releases.
- **Console.**
  - A manifest-driven module registry with an enumeration test: 100% of pages and actions go through the policy.
  - All 15 panel tabs are kept.
  - The Excel wizard uses exceljs with a dry-run diff and a job for more than 10k rows.
  - The console bundle stays at or under 250 KB gzipped, with no editor or three code.
- **Performance.**
  - Deterministic WH-M and WH-L warehouse fixtures with measured baselines on pristine 1.0.3.
  - A complexity tier maps to a quality policy.
  - An idle render governor built on `useViewer.setRenderPaused`.
  - Real-user monitoring through upstream `publishPerfBatchStats`, rolled up by pg_cron with breach events.
- **Editor UX.**
  - A commit-driven 12-step getting-started tour on `data-guide-target` anchors.
  - The ShellMode-aware cursor (`url('/cursor.svg') 4 2`).
  - A revision-linked capture/export policy.
  - An edit lock (EditGate) combining `getSceneAccess`, a single `acquireSceneReadOnlyLease` and `composeHistoryDelegate`.
- **Presentation and XR.**
  - Redacted artifacts are compiled per profile (public, shared, internal) at publish time; the public artifact can ship without the scene graph.
  - An editor-free runtime at `/p/[slug]` and `/s/[token]`, with a driver/modifier resolver.
  - Poses are anchored and normalized so they scale to 30k m².
  - Display types are a registry, with demo-listing as the first.
  - GLB baking runs through PublishBakeHost via `viewerSceneSlot`.
  - XR is a mode: `@webxr/plugin` in the editor, a non-editor adapter in `/p`, and a Permissions-Policy header.
- **MCP.**
  - A stateless hosted `/api/mcp` over `DtSceneStore`.
  - API keys are attenuated policy subjects.
  - `executeTool` goes through a capability map, a mutex and events, with `onBehalfOf` attribution.
  - Extra tools: revisions, publish, and warehouse tools.
- **Resolved conflicts.**
  - Yjs is dropped: human-vs-human editing is serialized by the lease, and agent and console writes merge by field.
  - Bake state is owned by presentation.
  - Tour progress lives in `dt_user_prefs`.
  - The telemetry ingest route is shared.

## Upstream PRs (the user's 15)
Each PR comes from a new `dt/upstream-<topic>` branch in the ovurrsl/editor fork. Existing PRs are reused: #547 for the clipboard and #554 for the area cap.

| # | PR | Interim until merged |
|---|---|---|
| UP01 | Level index | none (benchmark evidence) |
| UP02 | Frozen static transforms | plugin freezes its own groups |
| UP03 | DragBoundingBox unit geometry | warehouse move tool |
| UP04 | Parametric renderer disposal | dt-patch only if the leak budget is exceeded |
| UP05 | Remove the 10,000 m² cap | plugin "Large hall" action (hides itself once upstream detects halls) |
| UP06 | Slider maxes | host unclamped inputs |
| UP07 | Walkthrough speed | default speeds |
| UP08 | Clipboard (#547) + id prefix | host plugin-aware copy/paste + probe |
| UP09 | Zone inspector extensions | rail Zone section |
| UP10 | Plugin zone contents | `zone.deleteWithContents` command |
| UP11 | Mutation guard + selection filter | server-authoritative commit + EditGate |
| UP12 | `actionMenu` prop | **dt-patch** |
| UP13 | Upload error reasons + drag-box disposal | **dt-patch** |
| UP14 | Structure-only duplicate | host command |
| UP15 | Texture disposal | plugin refcounted LRU; dt-patch only if needed |

Every interim switches itself off through `@dt/compat` once upstream lands the change. Patches retire themselves when `git apply -R` succeeds.

## Roadmap (each milestone deploys independently)
Every milestone must pass three gates: `dtctl protect` finds 0 upstream diffs, contract tests are green, and the preview smoke e2e is green.

- **M0 Decisions + spikes.**
  - Decisions: D1 `dt/` install root versus the fallback of diverging only `bun.lock`; D2 Vercel plan; D3 Supabase plan.
  - Spikes: dt root install; stateless MCP; broadcast signal; zundo rebase on 30k nodes in under 50 ms; P0 performance baseline.
- **M1 Repo, artifacts, empty studio.** Bare-clone push, inherited workflows disabled, dt-protect/artifacts workflows, `dt/studio` bootstrap with roof and utilities, `@dt/studio-ux` adapter.
- **M2 Data, identity, policy.** Supabase prod and staging, `@dt/db`, `@dt/identity`, `@dt/policy`, events/runtime, mail, dt-migrate.
- **M3 Scene service + editor persistence.** Assets, commit, scene-client, `/project/[id]`, PR #49 features re-homed, compat plus UP12/UP13 patches.
- **M4 Collaboration, lock, history.** Leases, signals, remote apply with undo rebase, EditGate + categories, revisions/restore/backups/share links. Open PR UP11.
- **M5 Console shell + core modules.**
- **M6 Warehouse plugin 1.0.3 + server.** `/model`, `/api/wh`, projection, clipboard shim. Open PRs UP08–UP10.
- **M7 Warehouse console.** Locations, SVG plan, rack editor, Excel wizard, reports.
- **M8 Hosted MCP + webhooks.**
- **M9 Presentation + GLB.** Compile, `/p`, `/s`, runtime, console tab, bake, showcase.
- **M10 Performance runtime + experience modes.** Explode, x-ray, cut. Open PRs UP01–UP07 and UP15 with evidence.
- **M11 XR, capture, tour, presets, radio, hub/SEO.**
- **M12 Sync hardening.** Daily dt-sync with auto-merge on green, nightly visual and performance runs, upstream-PR status in the console.

## Tooling during development
- pascalorg/skills installed into `.agents/skills` (additive): glb-web-export, image-compare, contrast-check, web-design.
- Upstream skills pascal-3d and furniture-fit, with local `pascal mcp connect`.
- lingo comes with upstream and is used for MCP arguments and console forms.

Not integrated:
- blaze: optional.
- photogrammetry and LiteReality: console guides only.
- WorldSculpt and Fire3D: watch only.

## Verification
- **On every PR:**
  - `dtctl protect` / `collide` / `drift` / `env-guard` / `migrate-lint`;
  - typecheck, biome and i18n parity;
  - grep gates: no MySQL host, no `DEV_FALLBACK_SESSION`, no `CORS *`, no raw DB client outside `@dt/db`.
- **On every sync PR:** the contract suite runs against the new upstream pack, and a pristine-pack smoke runs on 5 routes.
- **Supabase integration tests** (local `supabase start`):
  - RLS denies anonymous users;
  - epoch triggers are atomic;
  - one commit produces exactly one event;
  - projection revision equals scene revision;
  - outbox → webhook works.
- **Golden-journey Playwright test on a Vercel preview:**
  1. An admin creates a user in the console; that user signs in.
  2. Build a warehouse.
  3. A collaborator spectates while console relabels and MCP edits arrive, and the owner's undo keeps the agent's edits.
  4. Lock a category; forged saves get 403.
  5. Publish, bake, and open `/p` as guest, share-link holder and internal user; check the redaction diff.
  6. Enter XR in IWER.
  7. Revoke the share link: 404 on the next request.
  8. Audit and webhook show the full chain.
- **Performance:** nightly WH-M and WH-L runs against the P0 budgets. A manual Quest 3 pass per release. A monthly upstream sync drill.
