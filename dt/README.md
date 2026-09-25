# DigitalTwin layer

Everything DigitalTwin adds on top of [pascalorg/editor](https://github.com/pascalorg/editor) lives
in this `dt/` folder (plus `.github/workflows/dt-*.yml`). The rest of the repository is an
untouched copy of pascalorg/editor.

## Why

pascalorg/editor updates must be taken as-is (fast-forward / overwrite) without breaking our
work. Because no upstream file is ever edited here, `git merge upstream/main` cannot conflict.

| Rule | Enforced by |
|---|---|
| Upstream files stay byte-identical | `dt-protect` workflow (`dt/scripts/protect.sh`) |
| Upstream is merged daily through a PR | `dt-sync` workflow |
| Upstream changes we need are proposed upstream | PRs to pascalorg/editor; interim workarounds live in plugins / our app |

## Branches

- `upstream-main`: a mirror of pascalorg/editor `main` (fast-forward only).
- `main`: `upstream-main` + the DigitalTwin layer.

## One-time repository settings

- Settings → Actions → General → enable **"Allow GitHub Actions to create and approve pull requests"** (needed by `dt-sync`).
- Actions → disable the inherited **`mcp-registry`** workflow (it would publish pascalorg's `server.json`). `release` is manual-only and can also be disabled.

## Docs

- `docs/PLAN.md`: roadmap and milestones.
- `docs/DESIGN.md`: integrated system design (shared foundations, domains, upstream PR list).

## Platform limits we design for

Vercel Hobby and Supabase Free:

- Background work runs through Supabase `pg_cron` + `pg_net` rather than Vercel Cron (Hobby only allows daily crons).
- Staging is a second free Supabase project, since branching is not available.
- Uploads are capped at 50 MB, so large GLBs are compressed (meshopt/KTX2) before upload.
- Function bodies are capped at 4.5 MB, so every large payload uses signed direct upload/download.
