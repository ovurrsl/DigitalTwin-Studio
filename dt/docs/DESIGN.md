# DigitalTwin-Studio: integrated system design (upstream `ebe69be26`, pascalorg/editor 1.0.3)

Before writing this, I re-checked the key anchors on `upstream/main`. These are correct:

- `use-scene.ts`: `:1228` setReadOnly, `:1862` acquireSceneReadOnlyLease, `:2178` applySceneOperationPatch, `:2266` applySceneSnapshot
- `mcp/src/storage/types.ts`: `:121` SceneStore, `:142` SceneVersionConflictError
- `mcp/src/server.ts`: `:33` createPascalMcpServer, `:38/:49` executeTool install
- `plugin-panels.ts:89`
- `viewer-presentations.tsx:154`
- `registry.ts`: `:339` getHostRefFields, `:432` extendPluginDiscovery
- `types.ts`: `:974` Plugin, `:1756` hostRefFields, `:2096` isValidPosition
- `editor/index.tsx`: `:166` EditorProps, `:199` viewerSceneSlot, `:206` guardAgainstSceneWipe, `:220` isVersionPreviewMode
- `history.ts`: `:37`, `:132`
- `space-detection.ts:785`
- root workspaces are `apps/* packages/* tooling/*`

Two corrections to the domain designs:

1. `parseNode` lives at **`packages/core/src/schema/compiled-node-parsers.ts:103`**, not `registry/`. It checks only built-in node schemas (`nodeSchemaForKind ?? AnyNode`) and **rejects plugin kinds**. Any server-side validation that relies on plain `parseNode` would therefore reject every warehouse node. This is fixed in F3 below.
2. `SceneBridge` rejects plugin kinds on create (`scene-bridge.ts:364`, `:489`). This confirms that the warehouse MCP tools are required.

---

## 1. System overview

```
                         pascalorg/editor (read-only producer, merged daily, never edited)
                                   │  git merge (conflict-free: we only add dt/** + .github/workflows/dt-*.yml)
                                   ▼
  ┌──────────────────── dt-artifacts CI ─────────────────────────────────────────────┐
  │ root install (pristine bun.lock) → apply dt/patches (UPxx.diff, auto-retire)       │
  │ → build core/viewer/nodes/editor/mcp → pack @ovurrsl/pascal-*@1.0.3-dt.<sha>.<ph>  │
  │ + repack github: plugins (webxr, env, bones, trees, …) + plugin-warehouse release  │
  └───────────────────────────────┬──────────────────────────────────────────────────┘
                                  ▼ GitHub Packages (npm alias → @pascal-app/*)
 dt/ (own install root, dt/bun.lock)          Vercel project root = dt/studio (Node runtime)
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ dt/studio  (Next 16 host)                                                         │
 │  /project/[id]  Editor + ShellMode + EditGate + SceneClient + Capture + Tour       │
 │  /p/[slug] /s/[token] /embed /bake   Experience runtime (no @pascal-app/editor)    │
 │  /console/[[...tab]]   manifest-driven modules (users, roles, scenes, warehouse…)  │
 │  /api/{auth,scenes,wh,assets,jobs,cap/sheet,telemetry,mcp,p,internal/tick}        │
 ├──────────────────────────────────────────────────────────────────────────────────┤
 │ Foundations (dt/packages)                                                         │
 │  @dt/env  @dt/db(dbAs)  @dt/identity(Better Auth)  @dt/policy(decide)             │
 │  @dt/events(catalogue)  @dt/runtime(outbox+jobs+tick)  @dt/assets  @dt/signal     │
 │  @dt/scene(commit/materialize/SceneStore)  @dt/scene-client  @dt/compat           │
 │  @dt/i18n  @dt/mail  @dt/console  @dt/studio-ux  @dt/perf  @dt/presentation-*     │
 │ Domain plugins: @ovurrsl/plugin-warehouse{., /model, /ui, /console, /icons}       │
 │                 @dt/plugin-roof  @dt/plugin-utilities                             │
 └───────────────┬───────────────────────────────┬──────────────────────────────────┘
                 ▼                               ▼
   Supabase (NEW project; prod + one staging/branch per preview)   Storage (private buckets)
   schemas: auth_ba (BA, role dt_auth) · dt (FORCE RLS, role dt_app)   scene-snapshots/ media/
   pg_cron + pg_net → HMAC /api/internal/tick   Realtime: content-free pings only   presentations/
```

The system has one write spine. Every path below uses the same five-stage chain:

```
editor autosave · MCP tool · console field edit · warehouse command · Excel/IFC import · restore · publish
   └──► @dt/scene.commit(ctx, delta)
          ├─ @dt/policy.decide  (+ lease epoch, category lock, field allowlist)
          ├─ merge (nodeId,key) · registry-aware validate · wipe guard
          ├─ txHooks (warehouse projection, complexity)
          ├─ @dt/events.emit(tx)  → dt_events (outbox)
          └─ after commit: @dt/signal ping {version}
                 └──► @dt/runtime consumers: audit view, webhooks, mail, KPI, bake,
                      warehouse reconcile, CON-LOGS
```

---

## 2. Shared foundations

These are the overlap resolutions: one owner and one mechanism for each concern.

### F1 Repo, lockfile and patch set (owned by platform)

**Layout.** All our code lives under `dt/`, which has its own install root. Workflows are added as `.github/workflows/dt-*.yml`. The upstream tree, including the root `bun.lock`, stays byte-identical.

- `dtctl protect` has **no exceptions**.
- **This replaces** the editor-ux design's `apps/studio` + `packages/dt-studio-ux`, the root bun.lock divergence, and `apply-dt-patches.ts` rewriting the Vercel workspace.
- **D1 fallback, only if the Phase-0 spike fails and the user signs off:** our code moves into upstream's workspaces and only `bun.lock` diverges.
- **Path mapping.** Every design reference to `apps/studio` becomes `dt/studio`, and `packages/dt-*` becomes `dt/packages/*`.

**Consuming upstream.** Upstream packages are consumed as packed artifacts: `@ovurrsl/pascal-*@1.0.3-dt.<sha>.<patchsetHash>`, aliased back to `@pascal-app/*`.

**Patch state and feature flags: one module, `@dt/compat`.**

- **Inputs:**
  - `dtPatches` baked into each pack's `package.json`;
  - typed "upstream-has" probes (conditional types plus contract tests) for features that land upstream.
- **It replaces** the warehouse `UPSTREAM_FEATURES` flag file, the editor-ux `report.json`, the perf ad-hoc detection, and the presentation `'walkthroughSpeedScale' in useViewer.getState()` check. Each of those becomes a `compat.*` accessor.
- **Lint rule:** symbols added by a patch may only be imported through `@dt/compat`.

**dt-patch policy (resolved across domains).** A patch is used **only** where there is no outside workaround and the lack of one blocks a product feature.

| Status | Items | How it ships |
|---|---|---|
| Patch now | UP12 (actionMenu prop), UP13 + OF25-B (upload error reasons, drag-box disposal) | dt-patch |
| Patch only if P0 leak cycles exceed budget | UP04, UP15 | dt-patch, conditional |
| No patch, bench evidence only | UP01, UP02, UP03 | wait for upstream merge |
| No patch, interim outside the editor | UP05 | plugin Large-hall action |
| | UP06 | host unclamped inputs |
| | UP07 | compat fallback to default speeds |
| | UP08 | host plugin-aware clipboard + probe |
| | UP09, UP10 | warehouse rail Zone section / command |
| | UP11 | server-authoritative lock + host stopgap |
| | UP14 | host command |

The target is ≤ 6 patches at start and ≤ 3 after 90 days.

### F2 Data access: `@dt/db` (one entry point)

**Connection roles.** There are three roles: `dt_migrator`, `dt_auth` (CRUD on schema `auth_ba` only) and `dt_app` (NOBYPASSRLS).

**`dbAs(subject, fn)` is the only application DB path.** It runs:

- a transaction on the Supavisor transaction pooler (`prepare:false`);
- `set_config('dt.org')`, `set_config('dt.subject')` and `set_config('dt.claims', DbClaimsV1)` with `is_local = true`.

**RLS** is coarse: tenant isolation plus anon/authenticated `REVOKE ALL`. It fails closed when the context is unset.

- This reconciles the scene domain's "service role + dt.subject", the platform domain's `set local role authenticated + request.jwt.claims`, and the identity domain's `dt_app`. **Chosen: identity's `dt_app` + `dt.*` GUCs**, with the claim shape `DbClaimsV1 {v, sub, org, caps[]}` shared with P-CAP as a zod contract.
- The service role is used only inside `@dt/runtime` (the drainer) and for Storage signing.

**Schema ownership.**

| Tables | Owner |
|---|---|
| `scene_docs`, `scene_revisions` (+`complexity`, `tier`), `scene_blobs`, `scene_ops`, `scene_leases`, `json_docs` + `json_doc_revisions`, `publications`, `presentation_artifacts`, `mcp_bindings` | P-SCENE |
| `dt_roles`, `dt_assignments`, `dt_scene_policy`, `dt_field_policies`, `dt_share_links`, `dt_api_keys`, `dt_policy_epoch`, `dt_rate_limits`, `dt_org_settings`, `dt_invitations`, `dt_access_requests`, `dt_user_prefs` (locale, theme, tour, profile visibility), `dt_webhook_subscriptions` | P-CAP / identity |
| `dt_events`, `dt_consumers`, `dt_jobs` | `@dt/runtime` |
| `dt_assets` | `@dt/assets` |
| `wh_slot_overlays`, `wh_slot_projection`, `wh_import_runs`; `sites.addressing` jsonb (column on the CON-SITES table) | warehouse |
| `perf_samples`, `perf_rollup_hourly` (matview) | perf |
| `preset_items`, `user_guidance_progress` (merged into `dt_user_prefs.tour_progress`; the editor-ux table is dropped) | editor-ux |

**Migrations** are expand-only and linted. `dt-migrate` runs before promotion (Vercel Deployment Check).

### F3 Scene service: `@dt/scene` (single write path; scene domain design is the base)

**Wire and storage format.** `NodeDelta {upserts, changedKeys, deletes, meta}` is the single format for writes and storage.

- The warehouse `plan()` returns a **NodeDelta** instead of a SceneOperationPatch.
- `@dt/scene/delta` owns the one converter, `toSceneOperationPatch`, which is contract-tested against `applySceneOperationPatch` (`use-scene.ts:2178`).
- The warehouse `applyPatch` equivalence test collapses into this same test (one pure applier: `applyDelta`).

**Validation (corrected).** Validation uses `validateNode(kind)`, which resolves in this order:

1. the registry schema for the kind: server-side `loadPlugin` of `@ovurrsl/plugin-warehouse` (root manifest, which must be SSR/Node-safe) or the build-time `node-schemas` manifest;
2. otherwise `parseNode` (`schema/compiled-node-parsers.ts:103`) for built-in kinds.

An unknown kind is rejected at import time. It is tolerated in `edit` mode only if it was already present at the base version (loose-schema rule, from the warehouse domain).

**`commit()` stages, in order:**

1. `SELECT … FOR UPDATE`
2. `decide(scene.write …)` with `touchedKinds → categories` (below)
3. lease epoch check
4. merge at (nodeId, key); `children` merged as an ordered set
5. validate
6. server wipe guard
7. **`txHooks`**:
   - the warehouse slot projection, written in the same transaction;
   - the complexity profile bounds check (perf);
8. `emit`
9. after commit: signal ping and `after()` compaction

**Category lock** is computed from the **delta**, not from a full-graph diff:

- `touchedKinds → policyCategory` comes from the build-time `category-manifest.json`, produced by `gen-policy-manifest.ts` in the studio build via `loadPlugin` (`registry.ts:359`);
- plus a derived allowance for transform-only changes.

This removes the identity domain's separate `authorizeSceneWrite(prevHashMap, nextGraph)` pass. The identity domain's 150 ms target becomes a check on delta size.

**Access state.** `getSceneAccess(subject, docId) → {mode, reasons: policy|locked|lease|archived, lockedCategories, version, leaseEpoch}`. This single primitive feeds EditGate (identity), `useSceneLease` (scene-client) and ShellMode `readonly` (editor-ux).

**Light JSON tier.** `json_docs` (+ revisions) holds these kinds: `presentation`, `env`, `tour`. The presentation domain's `doc_kind='presentation'` revisions map onto `json_docs` + `json_doc_revisions`. The light tier shares `authorize` and `emit` with the scene tier.

**`DtSceneStore implements SceneStore`** (`types.ts:121`) serves hosted MCP and conformance tests.

**Client: `@dt/scene-client`**, which absorbs the editor-ux SaveCoordinator:

- a shadow document and diff-based capture;
- an IndexedDB write-ahead journal: the unacked delta plus the base version, compressed; not the full graph;
- `expectedVersion`;
- a signed-snapshot path for large changes;
- a remote-apply loop with undo-stack rebase;
- `guardAgainstSceneWipe:false`, because the wipe guard runs on the server.

### F4 Policy: `@dt/policy` + `@dt/identity` (identity domain design is the base)

`decide(subject, action, resource, ctx) → {allow, reasons, obligations{redact[], readOnlyCategories, requireStepUp}}`, together with `explain` and `CapabilitySheet`.

**Unified action catalogue.** Parameters are written with `:`.

| Area | Actions |
|---|---|
| Scene | `scene.read`, `scene.write`, `scene.edit.category:<cat>`, `scene.patch.fields`, `scene.bulk_delete`, `scene.publish`, `scene.withdraw`, `scene.restore`, `scene.share`, `scene.export`, `scene.history`, `scene.xr`, `scene.lease.acquire`, `scene.lease.steal` |
| Presentation | `presentation.view`, `presentation.view:plan`, `presentation.view:walk`, `presentation.view:media`, `presentation.view:xr`, `presentation.author`, `presentation.quality.configure` |
| MCP | `mcp.tool:<name>` |
| Warehouse | `warehouse.slots.read`, `warehouse.overlay.write`, `warehouse.layout.labels.write`, `warehouse.layout.geometry.write`, `warehouse.import.run`, `warehouse.reports.read`, `warehouse.export`, `warehouse.scheme.manage` |
| Assets | `asset.<class>.<intent>` |
| Plugins, jobs, telemetry, perf | `plugin.use:<id>`, `jobs.manage`, `telemetry.write`, `perf.view`, `perf.lab` |
| Console and UX | `console.<module>.read`, `debug.view`, `capture.export:<fmt>`, `preset.read`, `preset.write`, `project.showcase.set` |

**Subjects:** user, apiKey, shareLink, anonymous, system, and impersonation-with-actor. Grants for API keys and share links are always attenuated to the creator's current grants.

**Revocation.** Epoch and outbox triggers fire on authority tables and on `auth_ba.users` / `auth_ba.sessions`. Clients learn about changes through an ETag-polled `/api/cap/sheet` (15 s), plus an optional F6 ping.

**Presentation profiles.** `presentationProfile(subject, publication) → public|shared|internal` covers three fixed profiles. Their RedactionRules are **generated from `dt_field_policies`** at compile time. This resolves identity's per-subject redaction versus the presentation domain's fixed profiles: the cache key is (publicationId, profile), which satisfies identity's "audienceClass" caching rule.

**OF10 (edit lock).** The identity domain says OF10 is undefined, but the inventory defines it (undo/redo toolbar, whole-scene lock, category visibility/lock, selection/delete/duplicate gates). **Owner: identity** (EditGate, `dt_scene_policy`, category stopgap). The editor-ux toolbar items render it.

### F5 Events and jobs: `@dt/events` + `@dt/runtime`

- **One table, `dt_events`** (seq, uuidv7 id, zod envelope from `@dt/events`, `webhook` / `readAction` flags per type). It unifies the scene domain's `domain_events`, identity's outbox and platform's `dt_events`.
- **Consumers** use `dt_consumers` cursors and dispatch into `dt_jobs` with idempotency key `consumer:seq`.
- **Tick triggers, in priority order:**
  1. `after()` on the enqueueing request;
  2. **pg_cron + pg_net** calling the HMAC `/api/internal/tick` every 30 s. The job is created per environment by a post-deploy script, not a migration, so previews never tick prod.
  3. Vercel Cron as an optional extra on Pro.
- This resolves the scene domain's pg_net trigger per insert, identity's pg_cron, and platform's Vercel Cron. A per-insert trigger is dropped in favour of `after()` plus the 30 s sweep, which is simpler.
- **Audit (CON-AUDIT) and the ops stream (CON-LOGS)** are views over `dt_events`.
- **Scene event IDs:** `SceneEvent.eventId` = `scene_ops.seq`. `scene.edited` and `scene.nodes_changed` are live-only and never webhooked.

### F6 Signals: `@dt/signal` (replaces 5 realtime mechanisms)

**Transport.** Supabase Realtime **public broadcast**, sent server-side with the service role. The topic is `dt:<HMAC(orgSecret, resourceKind:id:rotation)>`.

**Payloads are content-free:**

- `{kind: 'scene.version', v}`
- `{kind: 'policy.changed'}`
- `{kind: 'pub.head', v}`
- `{kind: 'lease', epoch}`

All data is then fetched through authenticated routes (`/ops?after`, `/cap/sheet`, `/api/p/manifest`).

**Presence** uses pseudonymous session ids on the scene topic. Display names are resolved through the authorized `/api/scenes/:id/presence` route. The lease itself is authoritative in Postgres and refreshed by heartbeat.

**Optional upgrade:** scene domain Spike B (imported signing key, private channels). Client code does not change.

**Polling fallback:** 5 s for scenes, 15 s for policy.

This decision reconciles three positions: platform and identity ("no Realtime JWT minting"), scene and presentation (pings), and editor-ux (presence).

### F7 Assets: `@dt/assets` (platform design)

- Upload flow: intent → signed PUT → finalize → `asset.verify` job → per-org content-addressed store after the server hashes the bytes.
- Download: `/a/:id` returns a 302 to a signed URL with a 300 s TTL.
- Buckets: `scene-snapshots`, `media`, `presentations`, `exports`.
- Every sign call runs `decide(asset.<class>.<intent>)`.
- **Size thresholds.** The scene domain used 1 MB (ops) and 4 MB; platform used 3.5 MB gzip. **Unified:**
  - inline POST if the gzipped size is ≤ 1 MB for `/ops`, or ≤ 3.5 MB for `/commit`;
  - otherwise a signed upload;
  - decompressed output is capped at 64 MB.

### F8 Host shell: `@dt/studio-ux` (editor-ux design)

- **Adapter** with a contract test covering symbols, event keys and behavioural contracts.
- **`buildEditorProps(ctx)`** plus an item registry.
- **ShellMode**, including XR fed from the XR domain's `useXrSession`.
- **Capability-filtered command catalog.**
- **CaptureService** (thumbnail, snapshot, print, GLB, and **presentation bake**; see D6).
- **Guidance**, presets and a sibling overlay host.

Absorbed or removed:

- The SaveCoordinator is replaced by F3 `@dt/scene-client`.
- The editor-ux presence code is replaced by F6.

### F9 i18n, theme and mail

- `@dt/i18n`: ICU catalogue en/tr with namespaces console, auth, mail, audit, presentation, tour, guides, and `plugin.<id>`.
- `--color-dt-*` tokens scoped under `[data-dt-theme]`.
- `@dt/mail`: auth mail sent synchronously, notifications through jobs.

### F10 Contract suite: `dt/packages/tooling/contracts`

Every domain's upstream contract tests live in one suite run by `dt-sync`.

---

## 3. Domain summaries (what goes beyond the old system)

| Domain | Replaces (old system) | New capability |
|---|---|---|
| **Platform** | Fork with 257 edited upstream files, hourly pin commits, Hostinger standalone build, setInterval workers | Zero upstream diff including bun.lock; one artifact identity (upstream sha + patch-set hash) drives cache, patch state and supply chain; self-retiring patches; installs that never touch codeload; expand-only migrations with a deploy gate; environment isolation by construction |
| **Scene / collab / MCP** | SQLite/MySQL stores, jsonb rows, presence 423 guard, share rows, unmounted Yjs, stdio MCP on live MySQL | Snapshot + op log with field-level server merge; epoch-fenced leases; undo-safe remote apply; hash-named revisions (duplicate/restore in O(1)); server-side wipe guard; multi-tenant hosted MCP that runs upstream tools unmodified, with attribution via onBehalfOf |
| **Identity / policy / console** | Custom argon2 + dt_session, requireSitePermission (reverted), UI-only API keys, `USING(true)` RLS, bypass flags | One isomorphic decision engine for every enforcement point; Better Auth default-deny HTTP surface; atomic revocation through triggers; exact cross-instance rate limiting; API keys and share links as first-class attenuated subjects; manifest-driven console with an enumeration test |
| **Warehouse** | Duplicated panel formulas, `warehouse_locations` copies, untyped BroadcastChannel, 3 fork-only core capabilities | One serverless-safe kernel (`/model`) shared by plugin, console, MCP and presentation facts; slot keys derived from node ids; projection written in the commit transaction; a typed command algebra whose `plan()` emits NodeDelta; normalizers (vertical openings) that also run server-side |
| **Performance** | Ad-hoc perf patches in viewer/editor/core | Deterministic fixture (WH-M/WH-L) with measured baselines per backend; complexity tier → quality policy; idle governor using only public levers; RUM through upstream's own `publishPerfBatchStats` channel; pg_cron rollups and breach events |
| **Editor UX / host** | Slot/string edits, a timer-based tour, a global cursor override | Single adapter with contracts; ShellMode drives chrome, cursor, audio and tour; capability-filtered commands (a viewer never sees edit actions); revision-linked capture artifacts under one ExportPolicy; commit-driven tour with host-owned anchors; presets for any isPresettableKind |
| **Presentation / XR** | Hard-coded Bursa manifest with CORS *, `/viewer` built on the editor, vanilla-three listing clone | Publish-time redacted artifacts per profile (public can ship with no graph); an editor-free runtime with drivers and modifiers plus a conflict resolver; anchored, normalised poses that scale to 30k m²; display types as a registry; XR as a mode; environment persisted only through the public `ViewerPresentationConfiguration` contract |

---

## 4. Interconnection map

The one set of consistent interfaces:

```
@dt/policy.decide ◄──────── every route (withCapability), scene.commit, MCP executeTool,
      ▲                     assets.sign, presentation compile/manifest, webhook filter,
      │ grants/epoch        console module guards, command catalog, EditGate(UX only)
@dt/identity (BA) ──triggers──► dt_events (policy.epoch.bumped, identity.*)

@dt/scene.commit(ctx,{docId, baseVersion, delta|snapshotHash, mode, origin, onBehalfOf, commandId}, txHooks)
   callers: scene-client(editor)  /api/wh/commands(plan→delta)  MCP DtSceneStore.save
            console scene/field edits  ingest(IFC/JSON/backup/Excel layout)  publish/restore
   txHooks: warehouse.projection(affectedRows)  perf.complexity(bounds)  
   emits:   scene.* → consumers: audit, webhooks, warehouse.reconcile, presentation.compile(on publish),
            bake.pending(tier≥L), kpi
getSceneAccess ──► EditGate (single acquireSceneReadOnlyLease + composeHistoryDelegate)
               ──► ShellMode 'readonly'   ──► useSceneLease banner (viewerBanner)
@dt/signal pings ──► scene-client(/ops?after), cap-sheet refetch, /p manifest refetch, jobs console
@dt/assets ◄── scene snapshots, capture artifacts, GLB bake, Excel/IFC sources, thumbnails, exports
warehouse /model ──► plugin UI · console workspace · /api/wh · MCP tools · PRES facts · perf fixture
                     category manifest (extensions['dt.policy'].category) · def.hostRefFields
json_docs(presentation|env|tour) ──► PresentationStateBridge (/project + console) · Tour progress
```

Resolved cross-domain conflicts:

| Conflict | Resolution |
|---|---|
| WH-SYNC-BRIDGE vs P-EVENTS | Bridge deleted (`store.ts:800-878`). Console relabels go through `scene.patch.fields` (warehouse allowlist) merged against a live editor. Geometry commands are refused while another user holds the lease. |
| OF05 lease vs OF06 CRDT | Yjs dropped. Human-vs-human edits are serialised by the lease; agent and console writes merge by field. |
| Undo delegate | EditGate installs through `composeHistoryDelegate(gate, collab)` (`history.ts:37`). Scene-client undo rebase acts on temporal state and does not install a delegate. |
| XR vs idle governor / cursor / experience | Governor is off under `useImmersiveXRPresentation`. Cursor rule excludes `[data-shell-mode=xr]`. Presentation resolver: XR suspends story, pins become sprites, tier forced to GLB. `immersive` is passed only during a live session. |
| PR49-HUB vs P-PROTECT | The hub lives in `dt/studio`. The upstream `apps/editor` is not deployed. |
| PR49-AUTH vs CON-AUTH | Both become Better Auth plugins/hooks in `@dt/identity`. |
| Bake ownership (perf `bake_state` / presentation `/bake` / capture) | State is `presentation_artifacts.glb_status` (presentation owns it). Execution is a CaptureService job kind `bake`, run by `PublishBakeHost` via `viewerSceneSlot` (`index.tsx:199`) or the `/bake/[publicationId]` tab. Perf only sets `tierPolicy`. |
| Telemetry routes | `/api/telemetry/{error,perf}` with one signed ingest token (sendBeacon has no headers) and one `consume()` limiter. |
| Tour progress | `dt_user_prefs.tour_progress`. The step content key is shared with CON-GUIDES. |
| Warehouse plugin distribution | GitHub Packages release tags containing a tsup `dist`. The platform pipeline consumes them. |
| MCP bridge concurrency | One in-process mutex plus incremental rehydrate (`SceneBridge` drives the global `useScene`). A per-request bridge does not isolate state. |

---

## 5. Upstream PR list (the user's 15, plus how each plugs in)

| PR | Change | Interim until merged | Consumed via | Retires when |
|---|---|---|---|---|
| UP01 level index | memoised level lookups | none (bench evidence) | none | n/a |
| UP02 frozen static transforms | matrixAutoUpdate freeze | plugin freezes its own groups | none | n/a |
| UP03 DragBoundingBox unit geo | cache geo/materials | warehouse move tool avoids it | none | n/a |
| UP04 parametric renderer disposal | dispose on unmount | dt-patch only if P0 leak cycles exceed budget | behavioural | `git apply -R` succeeds |
| UP05 remove 10,000 m² cap (#554) | `space-detection.ts:785` | plugin **Large hall** action | `detectSpacesForLevel` result | action hides itself once detection returns the hall |
| UP06 slider maxes | level height / guide scale | host unclamped inputs (`updateNode`) | `compat.unclampedSliders` | contract probe |
| UP07 walkthrough speed | `useViewer` multiplier | default speeds | `compat.walkSpeedScale` (value from perf policy f(√area)) | typed probe |
| UP08 registry-aware clipboard (#547) | `scene-clipboard.ts` + lastIndexOf prefix | host plugin-aware Ctrl+C/V + "Duplicate with references" (`cloneNodesInto`, `hostRefFields`); single-token id prefixes; WHG-5 ingest migrator | `compat.registryClipboard` | CI paste probe |
| UP09 zone → plugin inspectorExtensions | panel-wrapper zone path | rail Zone section | `compat.zoneInspectorExtensions` | moved in the pin-bump PR |
| UP10 collectZoneContentIds plugin kinds | zone-content.ts:99 | `plan(zone.deleteWithContents)` | `compat.pluginZoneContents` | command deleted |
| UP11 mutation guard (+ selection filter) | `setSceneMutationGuard` in node-actions, `applySceneOperationPatch`, `runUndo`/`runRedo`; runUndo short-circuits when readOnly | server-authoritative commit; EditGate stopgap (selection strip, `setTool(null)`) | `compat.sceneMutationGuard` | feature-detect |
| UP12 actionMenu prop + rail exports | EditorProps `actionMenu` | **dt-patch** (api class) | `compat.editorActionMenu()` | `-R` check |
| UP13 upload error reasons (+ OF25-B drag-box disposal) | view-toggles / site-panel | **dt-patch** | behavioural | `-R` check |
| UP14 structure-only level duplicate | level-duplication.ts | host command (editor-ux owns it) | `compat.structureOnlyDuplicate` | probe |
| UP15 texture disposal honouring cached flag | dispose-object3d.ts:8 | plugin refcounted LRU plus cached flag, shipped **before** the PR; dt-patch only if P0 justifies it | behavioural | `-R` check |

**Recommended extras (not part of the 15, none blocking):**

- FrameLimiter `idleFps` + kick-on-change;
- an exported SceneStore conformance suite;
- an `applySceneOperationPatch` temporal-rebase option;
- `EditorProps.presentationPersistence`;
- a BakeExporter `options` prop;
- a snapshot encode-options PR;
- widening plugin peer ranges.

---

## 6. Roadmap

Each milestone deploys independently on Vercel as a reviewable PR set. Every milestone must pass three gates:

- `dtctl protect` finds 0 upstream diffs;
- contract tests are green;
- the preview smoke e2e is green.

### M0: Decisions and spikes (no product code)

- **Decisions from the user:**
  - D1: `dt/` root, or the bun.lock-divergence fallback;
  - D2: Vercel Pro or Hobby;
  - D3: Supabase Pro (PITR, branching, >50 MB files).
- **Spikes:**
  1. `dt/` install root (one React, one three; turbopack root; aliases);
  2. stateless MCP transport with route-injected `Mcp-Session-Id`;
  3. public-broadcast signal from the service role (optionally the private-channel variant);
  4. zundo temporal rebase on 30k nodes (< 50 ms);
  5. P0 perf baseline on **pristine** 1.0.3 with WH-M/WH-L (fixture generated through the warehouse kernel stub).

**Exit:** spike report plus `perf-baseline.json`; the patch list is frozen from the P0 leak data.

### M1: Repo, artifacts and an empty studio

- ovurrsl/DigitalTwin-Studio is created by bare-clone push.
- Inherited workflows are disabled.
- Workflows `dt-protect`, `dt-baseline`, `dt-artifacts` (no patches yet), third-party repacks.
- `dt/studio` with bootstrap (plugin-roof and plugin-utilities as `@dt/*`), `@dt/env`, `proxy.ts`, and an in-memory `/project/[id]`.
- The `@dt/studio-ux` adapter with its contract test.

**Exit:**

- a canary edit to an upstream file fails CI;
- the Vercel install succeeds with codeload blocked;
- a preview deploys an editable in-memory project.

### M2: Data, identity and policy core

- New Supabase projects (prod and staging).
- `@dt/db` (`dbAs`, roles, FORCE RLS).
- `@dt/identity`: Better Auth 1.7.5 with computed `disabledPaths`, `dtAccountSecurity`, oAuthProxy and fail-closed env.
- `@dt/policy` with the catalogue and system roles.
- Epoch triggers; `/api/cap/sheet`.
- `@dt/events` + `@dt/runtime`: tick, pg_cron script, `after()`.
- `@dt/mail` for auth mail.
- `dt-migrate` with a Deployment Check.

**Exit:**

- the RLS suite shows 0 anon rows;
- the Better Auth surface test passes;
- sign-in works (email, magic link, Google via oAuthProxy on a branch URL);
- lockout is exact across 2 processes;
- 1,000 duplicate-key jobs each run exactly once.

### M3: Scene service and editor persistence

- `@dt/assets` (intent, verify, `/a/:id`).
- `@dt/scene`: commit, merge, registry-aware validate, wipe guard, snapshots, `after()` compaction, `DtSceneStore`.
- `@dt/scene-client`: shadow, IDB journal, large-change path.
- `/projects` and `/project/[id]` on the real store; PR49-PROJ relocated.
- `@dt/compat`, and dt-patches UP12/UP13 in the artifact pipeline.

**Exit:**

- the 20-writer property test passes;
- 8 MB graph and 20 MB GLB uploads succeed with no body over 4.5 MB;
- save p95 < 250 ms per delta;
- a killed tab recovers from the journal;
- the SceneStore conformance suite matches the Sqlite oracle.

### M4: Collaboration, lock and history

- Leases with epochs; `@dt/signal` pings and presence; remote apply with undo rebase.
- EditGate + `getSceneAccess` + category manifest; OF10 toolbar items.
- Revisions panel (`sidebarTabs`, `previewScene` + `isVersionPreviewMode`), restore, backup export and upload-restore, share links, trash.
- The UP11 PR is opened.

**Exit:**

- the 17-path lock matrix persists 0 bypasses;
- a spectator applies an edit in < 600 ms p95;
- a stale epoch is always rejected;
- a local undo never reverts a remote edit (1,000 interleavings).

### M5: Console shell and core modules

- `@dt/console` manifest registry, `@dt/i18n`, scoped theme, Cmd+K.
- Modules: users (dtAdmin, impersonation), roles (matrix + explain), sessions, sites (archive semantics), settings, audit, logs, jobs, scenes (publish/withdraw/feature/force-release/backups), integrations shell.

**Exit:**

- the enumeration test shows 100% of pages and actions wrapped;
- the console bundle is ≤ 250 KB gzipped with no editor or three code;
- EN/TR keys are at parity.

### M6: Warehouse plugin 1.0.3 and server

- Plugin branch: WH-COMPAT, tsup subpaths, `/model` kernel, adapters, `plan()` → NodeDelta, WHG-1/2/5, OF18/20/21, icon sprite, bridge deleted, `hostRefFields`, single-token prefixes, `extensions['dt.policy']`.
- Studio: `/api/wh/*`, projection txHook, `wh_*` tables, host clipboard shim with UP08 probe, UP09/UP10 PRs.

**Exit:**

- plugin CI green (biome 0 errors);
- the Node import of `/model` works;
- a console relabel reaches an open editor in < 1 s;
- the projection revision always equals the scene revision;
- vertical openings have 0 duplicate or lost holes;
- copy/paste of racks keeps references.

### M7: Warehouse console, Excel and reports

- Locations grid, SVG plan (CON-2D), fieldSpec rack editor, Excel wizard (exceljs, dry-run diff, job for > 10k rows), export, takeoff/BOM/ZDSU reports.
- CON-BULK reuses the same client parse path.

**Exit:**

- a 250k-row job completes in < 45 s;
- a stale-base commit re-plans with 0 lost updates;
- formula escaping passes;
- the deny matrix passes on `/api/wh`.

### M8: Hosted MCP and integrations

- `/api/mcp` (stateless, bindings, API keys as P-CAP subjects, `executeTool` capability map + mutex + events, hosted-mode denials).
- Extra tools: `list_revisions`, `restore_revision`, `publish_scene`, and the warehouse tools.
- Webhooks: Standard-Webhooks signatures, SSRF-safe connect.
- The integrations module.

**Exit:**

- MCP Inspector e2e passes, and an agent edit appears live without being undoable by the user's Ctrl+Z;
- 100% of tool calls produce `mcp.tool.called` with `onBehalfOf`;
- the SSRF suite passes.

### M9: Presentation (basic + story) and GLB

- `presentation-model` (config v1, AnchoredPose, redaction from field policies, compile), publications, the compile job, `/s/[token]`, `/api/p` manifest.
- `presentation-runtime` (session, drivers, modifiers, resolver, PlanView), `PresentationStateBridge` (in `/project` and the console).
- Console presentation tab.
- `PublishBakeHost` + `/bake`; GlbScene tier with walk; `/viewer` redirects.
- Showcase and profile.

**Exit:**

- the redaction leak test finds 0 hits across 3 profiles × 2 fixtures;
- `/p` contains 0 editor modules;
- freshness ≤ 5 s;
- an empty-localStorage restore is equal;
- 0 GLB bytes pass through functions.

### M10: Performance runtime and experience modes

- `@dt/perf` runtime (governor, collector, quality policy), `/api/telemetry/perf`, rollup matview + breach events, `/perf-lab`, CON-OVERVIEW health.
- Plugin work: OF13 InstancedMesh relocation, texture LRU, keep-awake hooks, `bake:'replace'`, Large hall action.
- Explode, x-ray and cut Tier 1 modes.
- UP01–UP06/UP15 PRs filed with evidence.

**Exit:** the WH-L budgets from P0 hold; wake is ≤ 50 ms; the leak cycles are within budget.

### M11: XR, capture, tour and polish

- XR adapters (`@webxr/plugin` in `/project`, a non-editor adapter in `/p`) with the Permissions-Policy header.
- CaptureService HQ/print/ExportPolicy.
- 12-step tour, presets, RadioDock, hub/SEO, portfolio (OF30).

**Exit:**

- the IWER emulator runs in CI;
- a manual Quest 3 pass;
- the tour completes through real edits;
- structure print output contains 0 ceilings;
- Lighthouse SEO ≥ 95 on the hub and viewer.

### M12: Automated sync hardening

- `dt-sync` daily with auto-merge on green.
- `dt-nightly` visual and perf runs.
- `dt-upstream-prs` status feeding CON-UPDATES.
- Automatic retirement verified by a scratch merge.

**Exit:**

- ≥ 90% of sync PRs auto-merge;
- an upstream release reaches production within 24 h;
- the patch count meets the 90-day target.

---

## 7. Risks (cross-domain; domain-local risks stay with their designs)

1. **The `dt/` install root may be infeasible** (hoisting, turbopack root). The M0 gate controls this; the fallback D1-B needs the user's explicit sign-off.
2. **Registry-aware validation on the server** needs plugin node definitions in Node. The plugin root manifest must be SSR-safe with lazy renderers, and the `/model` boundary lint enforces that. Until then, warehouse writes validate against kernel schemas and MCP warehouse tools stay flagged off.
3. **Singleton `useScene` in hosted MCP** bounds throughput. Mitigations: mutex plus queue-wait metrics, or a separate Vercel project for MCP.
4. **Undo rebase depends on the zundo temporal shape.** It is contract-tested, and bulk deltas fall back to `clearSceneHistory`.
5. **Public-broadcast signals** reveal only timing. HMAC topics rotate on share revoke; if that is not acceptable, the Spike B private channels replace them.
6. **Transactional projection plus the commit lock** adds commit latency on large renumbering. Above a threshold the work goes to a job and the revision is marked projection-pending.
7. **Better Auth minor releases.** Pinned at 1.7.5; computed `disabledPaths` plus contract tests.
8. **Supabase or Vercel plan limits** (pg_net and pg_cron availability, file size, PITR). Overview health checks and D2/D3 cover this.
9. **The private registry becomes a single point of failure** (token expiry, outage). Mitigations: immutable artifacts, the Vercel build cache, and a rotation reminder.
10. **Contract-test surface drift.** There is one suite (F10); any failure blocks only the sync PR, never production.
11. **Scope.** 12 milestones. M3, M4 and M9 carry the most risk and must not be merged together.

---

## 8. Verification (system-level; per-domain suites are unchanged)

- **Static, on every PR:**
  - `dtctl protect` / `collide` / `drift` / `env-guard` / `migrate-lint`;
  - dt typecheck, biome, stylelint scoping, i18n parity;
  - the compat-only import rule;
  - grep gates: no MySQL host, no `DEV_FALLBACK_SESSION`, no `CORS *`, no `xlsx@0.18.5`, no raw DB client outside `@dt/db`, no subject-dependent caching without a profile key.
- **Unified contract suite (F10), on every sync PR**, against the new upstream pack:
  - `SceneStore`, `SceneVersionConflictError`;
  - `createPascalMcpServer` / `executeTool` wrapping;
  - `applySceneOperationPatch` equivalence with `applyDelta`, and `false` on a live override;
  - `acquireSceneReadOnlyLease` refcount;
  - history delegate short-circuit, plus the allowlist grep for direct temporal calls;
  - `parseNode` built-in-only semantics;
  - registry `loadPlugin` / `extendPluginDiscovery` / `getHostRefFields`;
  - EditorProps slot names;
  - `registerViewerPresentation` / `ViewerPresentationConfiguration`;
  - FrameLimiter deps;
  - `publishPerfBatchStats`;
  - the `SurfaceHoleMetadata` `'manual'` value;
  - the 7 `data-guide-target` anchors;
  - the watch-listed owned copies (`webxr-feature-gate`, `bake-exporter`);
  - R3F pin equal to the upstream lock;
  - `compat` flags evaluated against both pristine and patched packs.
- **Pristine guarantee:** the studio builds and the 5-route smoke passes on `.pristine` packs.
- **Integration tests against `supabase start` through the real pooler:**
  - RLS denies anon, and `dt_app` without context sees nothing;
  - epoch triggers are atomic;
  - one commit yields exactly one primary event;
  - the projection revision equals the scene revision;
  - the outbox → webhook path delivers.
- **End-to-end on a Vercel preview** (Playwright with a bypass token, fresh staging data): one golden journey across domains.
  1. Sign in (Google via oAuthProxy).
  2. Create a project and build a warehouse via `layout.generate`.
  3. Collaborator spectates; a console relabel appears live; an MCP agent adds racks and the owner's undo keeps them.
  4. Admin locks the "structure" category; forged saves get 403.
  5. Publish, bake, and open `/p` as guest, share-holder and internal user; the redaction diff matches expectations.
  6. Enter XR in IWER.
  7. Revoke the share link: 404 within one request.
  8. Audit and webhook show the full event chain.
- **Performance:** a nightly WH-M/WH-L run on SwiftShader with count gates per backend, plus a `/perf-lab` run on the reference laptop for each release, compared with the P0-derived budgets.
- **Sync drill:** monthly scratch merge of upstream `main` HEAD, checking that contracts flag only intended changes and that retired patches report `retired`.

### Critical Files for Implementation

- /home/user/editor/packages/mcp/src/storage/types.ts (upstream/main: SceneStore `:121`, SceneVersionConflictError `:142`)
- /home/user/editor/packages/core/src/store/use-scene.ts (upstream/main: `:1228`, `:1862`, `:2178`, `:2266`)
- /home/user/editor/packages/editor/src/components/editor/index.tsx (upstream/main: EditorProps `:166-253`)
- /home/user/editor/packages/core/src/schema/compiled-node-parsers.ts (upstream/main `:103`, the corrected parseNode semantics)
- /home/user/editor/packages/mcp/src/server.ts (upstream/main `:33-49`)
- /root/.claude/plans/clever-singing-bunny.md (the draft this supersedes)