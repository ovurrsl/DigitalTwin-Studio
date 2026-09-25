#!/usr/bin/env bash
# dt/ mirrors upstream's dependency patches so the studio renders exactly like
# apps/editor. Fails when a mirrored patch drifted from, or vanished upstream.
# Run from the repo root.
set -euo pipefail

status=0
for mirror in dt/patches/*.patch; do
  name="$(basename "$mirror")"
  upstream="patches/$name"
  if [ ! -f "$upstream" ]; then
    echo "::error::$name is no longer patched upstream (patches/$name is gone). Update dt/package.json patchedDependencies to match."
    status=1
  elif ! cmp -s "$upstream" "$mirror"; then
    echo "::error::dt/patches/$name differs from patches/$name. Copy the upstream patch and run bun install in dt/."
    status=1
  fi
done

[ "$status" -eq 0 ] && echo "OK: dt/patches match upstream."
exit "$status"
