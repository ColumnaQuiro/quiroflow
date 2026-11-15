#!/usr/bin/env bash
# Remembers which tree `npm run preflight` last passed on, so the pre-push
# hook does not run the same two minutes of checks again on the commit that
# was just checked by hand.
#
#   preflight-stamp.sh tree           print the tree id of the working copy as
#                                     it is now: tracked AND untracked files,
#                                     everything preflight could have read
#   preflight-stamp.sh write <tree>   record that preflight passed on <tree>
#   preflight-stamp.sh covers <rev>   exit 0 if preflight passed on exactly
#                                     <rev>'s tree
#
# "Exactly" is the point. The id comes from a scratch copy of the index with
# every file added, so an untracked component that made the typecheck pass,
# or an edit not yet committed, gives a different id from the commit being
# pushed, and the hook runs preflight as before. The stamp lives in the git
# dir, so each worktree has its own.
set -euo pipefail

stamp=$(git rev-parse --git-path quiroflow-preflight-passed)

case "${1:-}" in
  tree)
    index=$(mktemp)
    trap 'rm -f "$index"' EXIT
    # Starting from the real index keeps git's stat cache, so this hashes
    # only what changed rather than every file in the repo.
    cp "$(git rev-parse --git-path index)" "$index"
    GIT_INDEX_FILE=$index git add -A
    GIT_INDEX_FILE=$index git write-tree
    ;;
  write)
    echo "$2" >"$stamp"
    ;;
  covers)
    [ -f "$stamp" ] || exit 1
    [ "$(cat "$stamp")" = "$(git rev-parse "$2^{tree}")" ]
    ;;
  *)
    echo "usage: $0 tree | write <tree> | covers <rev>" >&2
    exit 2
    ;;
esac
