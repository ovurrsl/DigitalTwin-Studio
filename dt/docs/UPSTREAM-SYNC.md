# Taking pascalorg/editor updates

1. `dt-sync` runs daily (or manually from the Actions tab):
   - It fast-forwards `upstream-main` to pascalorg/editor `main`.
   - It merges that into the branch `dt/sync-upstream` and opens or updates a PR into `main`.
2. CI on that PR runs `dt-protect`, upstream's own CI, and our layer's checks.
3. When the checks are green, merge the PR. No conflict resolution is ever expected: if a
   merge conflicts, some upstream file was edited on our side, which `dt-protect` forbids.

## If our layer breaks after an update

Fix it under `dt/`. Never patch the upstream file. If the fix needs an upstream change,
propose it as a PR to pascalorg/editor and keep a workaround under `dt/` until it lands.

## Manual sync

```sh
git remote add upstream https://github.com/pascalorg/editor.git
git fetch upstream main
git push origin upstream/main:refs/heads/upstream-main
git checkout -b dt/sync-upstream origin/main
git merge upstream/main
bash dt/scripts/protect.sh upstream/main
```
