#!/usr/bin/env bash
# Runs the given command once no other checkout on this machine is running a
# heavy one: one typecheck or production build at a time, machine-wide.
#
# A typecheck of this project takes about 4.5 GB and a production build is in
# the same range. With several sessions each working in their own worktree,
# six of them ran together on a 16 GB machine on 13 Nov 2026: it swapped, and
# a build whose server step takes about a minute took fourteen. Each session
# was waiting on the other five, not on its own work. In a line, six jobs of
# two minutes finish in twelve; in a pile they took fifty.
#
# So this is a queue, not a limit on what gets checked. scripts/with-node.sh
# sends `nuxt build`, `nuxt generate` and `nuxi typecheck` through it.
#
# The lock is a directory (mkdir is atomic; macOS has no flock) holding the
# owner's pid. A lock whose owner is gone is taken over, so a killed build
# never blocks the next one.
#
#   QUIROFLOW_NO_QUEUE=1        run at once, queue or not
#   QUIROFLOW_QUEUE_MAX_WAIT=N  give up waiting after N seconds (default 2700)
#                               and run anyway: late beats never
#
# CI is one job per runner and skips it.

if [ -n "$CI" ] || [ -n "$QUIROFLOW_NO_QUEUE" ] || [ -n "$QUIROFLOW_HEAVY_LOCK_HELD" ]; then
  exec "$@"
fi

LOCK_ROOT="${QUIROFLOW_QUEUE_DIR:-$HOME/.cache/quiroflow}"
LOCK="$LOCK_ROOT/heavy-check.lock"
MAX_WAIT="${QUIROFLOW_QUEUE_MAX_WAIT:-2700}"

# Nowhere to keep the lock (a sandbox without a writable home): run as before.
if ! mkdir -p "$LOCK_ROOT" 2>/dev/null; then
  exec "$@"
fi

held=0
release() {
  if [ "$held" = 1 ] && [ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ]; then
    rm -rf "$LOCK"
  fi
  held=0
}
trap release EXIT
trap 'release; exit 130' INT
trap 'release; exit 143' TERM

waited=0
told=0
while :; do
  if mkdir "$LOCK" 2>/dev/null; then
    echo "$$" > "$LOCK/pid"
    pwd > "$LOCK/where"
    held=1
    break
  fi

  owner="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -z "$owner" ]; then
    # Just created and not yet signed, or half removed: look again shortly.
    sleep 1
    owner="$(cat "$LOCK/pid" 2>/dev/null)"
  fi
  if [ -z "$owner" ] || ! kill -0 "$owner" 2>/dev/null; then
    # Its owner is gone. Move it aside first, so of two waiters only one takes it.
    if mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null; then rm -rf "$LOCK.stale.$$"; fi
    continue
  fi

  if [ "$waited" -ge "$MAX_WAIT" ]; then
    echo "[queue] still busy after ${waited}s; running anyway." >&2
    break
  fi
  if [ $((waited - told)) -ge 30 ] || [ "$waited" = 0 ]; then
    echo "[queue] waiting for the heavy check in $(cat "$LOCK/where" 2>/dev/null || echo 'another checkout') (pid $owner); ${waited}s so far. QUIROFLOW_NO_QUEUE=1 skips the queue." >&2
    told="$waited"
  fi
  sleep 5
  waited=$((waited + 5))
done

# A build that runs a typecheck inside itself must not queue behind itself.
export QUIROFLOW_HEAVY_LOCK_HELD=1

# In the background and waited for, so a signal reaches this script while the
# command runs: stopping the wrapper stops the build and frees the turn,
# instead of leaving the build running with the next one already started.
"$@" &
child=$!
stop() {
  kill -TERM "$child" 2>/dev/null
  wait "$child" 2>/dev/null
  release
  exit "$1"
}
trap 'stop 130' INT
trap 'stop 143' TERM
wait "$child"
code=$?
release
exit "$code"
