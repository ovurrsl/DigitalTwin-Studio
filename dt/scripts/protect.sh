#!/usr/bin/env bash
# Fails when anything outside the DigitalTwin-owned paths differs from upstream.
# Upstream (pascalorg/editor) must stay byte-identical so `git merge upstream/main`
# can never conflict. Owned paths: dt/** and .github/workflows/dt-*.yml.
#
# Usage: dt/scripts/protect.sh [upstream-ref]   (default: origin/upstream-main)
set -euo pipefail

UPSTREAM_REF="${1:-origin/upstream-main}"

base="$(git merge-base "$UPSTREAM_REF" HEAD)"

violations="$(
  git diff --name-only "$base" HEAD \
    | grep -Ev '^dt/' \
    | grep -Ev '^\.github/workflows/dt-[^/]+\.yml$' \
    || true
)"

if [ -n "$violations" ]; then
  echo "::error::Upstream files were modified. Move these changes under dt/ (or propose them upstream):"
  echo "$violations" | sed 's/^/  - /'
  exit 1
fi

echo "OK: no upstream file differs from $UPSTREAM_REF (merge-base $base)."
