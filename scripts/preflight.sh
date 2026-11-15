#!/usr/bin/env bash
# `npm run preflight`: everything CI's typecheck job checks before it builds.
#
# It used to be eleven `npm run` steps in a row, each starting its own npm,
# nvm and Node, with lint (~37s) and typecheck (~75s) both starting cold every
# time and waiting for each other. Measured on 15 Nov 2026 that was ~2 minutes
# a run -- and a push ran it twice, once by hand and once from the pre-push
# hook, on the same tree. Now:
#
# - the small checks run in one shell under one `nvm use`;
# - lint, unit tests and typecheck run side by side, each into its own log,
#   printed in order afterwards so a failure reads the same as before;
# - outside CI, ESLint and vue-tsc keep a cache in node_modules/.cache, so a
#   second run only re-checks what changed (typecheck ~75s -> ~11s);
# - a run that passes records the exact tree it checked, and the pre-push
#   hook skips the rerun when the commit being pushed IS that tree.
#
# CI sets CI=true and gets no caches: it always checks from scratch, so it
# stays the gate that does not depend on anything left over on a machine.
set -uo pipefail
cd "$(dirname "$0")/.."

# One nvm for everything below (see with-node.sh for why it matters).
if [ -z "${QF_PREFLIGHT_NODE:-}" ]; then
  export QF_PREFLIGHT_NODE=1
  exec ./scripts/with-node.sh "$0" "$@"
fi
export PATH="$PWD/node_modules/.bin:$PATH"

started=$(date +%s)
tree_before=$(scripts/preflight-stamp.sh tree)

# --- Small static checks: ~1s each, mostly Node starting. Fail fast. --------
# The same scripts as the `check:*` entries in package.json; a new check goes
# in both places.
for script in check-migration-versions check-migration-compatibility \
              check-e2e-shards check-theme-tokens check-rls-initplan \
              check-rls-two-factor i18n-extract check-table-grants; do
  echo "> $script"
  node "scripts/$script.mjs" || { echo "preflight: $script failed" >&2; exit 1; }
done

# --- The three slow ones, in parallel. ---------------------------------------
cache_dir=node_modules/.cache/quiroflow-preflight
mkdir -p "$cache_dir"
logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT

lint_args=()
tsc_args=()
if [ -z "${CI:-}" ]; then
  # content, not mtime: switching branches touches every file's mtime, and
  # the cache should survive that when the contents are the same.
  lint_args=(--cache --cache-strategy content --cache-location "$cache_dir/eslint/")
  tsc_args=(--incremental --tsBuildInfoFile "$cache_dir/vue-tsc.tsbuildinfo")
fi

run() { # name, command...
  local name=$1; shift
  local t0=$(date +%s)
  "$@" >"$logs/$name.log" 2>&1
  local rc=$?
  echo "$rc $(( $(date +%s) - t0 ))" >"$logs/$name.rc"
}

# What `nuxi typecheck` does, split in two so vue-tsc can be told where to
# keep its incremental state: generate .nuxt's types (as a production build
# sees them, which is why NODE_ENV is set), then check without emitting.
typecheck() {
  NODE_ENV=production nuxi prepare --logLevel silent &&
    NODE_OPTIONS=--max-old-space-size=8192 vue-tsc --noEmit "${tsc_args[@]}"
}

run lint eslint . "${lint_args[@]}" &
run unit vitest run &
run typecheck typecheck &
wait

failed=0
for name in lint unit typecheck; do
  read -r rc secs <"$logs/$name.rc"
  if [ "$rc" = 0 ]; then
    # Lint's warnings are still worth seeing on a pass; the others are noise.
    if [ "$name" = lint ] && [ -s "$logs/lint.log" ]; then cat "$logs/lint.log"; fi
    echo "> $name passed (${secs}s)"
  else
    failed=1
    echo
    echo "> $name FAILED (${secs}s):"
    cat "$logs/$name.log"
  fi
done

[ "$failed" = 0 ] || { echo; echo "preflight failed" >&2; exit 1; }

# Only record the tree if nothing changed while we were checking it --
# another session sharing this checkout can edit files mid-run.
if [ "$(scripts/preflight-stamp.sh tree)" = "$tree_before" ]; then
  scripts/preflight-stamp.sh write "$tree_before"
fi
echo "preflight passed in $(( $(date +%s) - started ))s"
