#!/usr/bin/env bash
# Runs the Cypress e2e suite against a local Supabase instance, mirroring
# .github/workflows/e2e.yml exactly. The repo's .env points at PRODUCTION
# Supabase, so without this the dev server and Cypress's db:createStaffAccount
# task disagree on which backend to hit and every login-dependent test fails.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.local/bin:$PATH"

if ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found on PATH" >&2
  exit 1
fi

echo "Starting local Supabase..."
supabase start

# `supabase start` only resumes whatever's already in the local DB volume --
# it does NOT apply migrations added since that volume was first created.
# In CI (.github/workflows/e2e.yml) this is a non-issue since the runner is
# always fresh, but a long-lived local volume silently drifts behind the
# migrations/ directory over time, and every login-dependent test starts
# failing against the stale schema with no indication why. `db reset`
# recreates the DB from migrations + seed.sql every run, matching what a
# truly fresh CI environment gets.
echo "Resetting local database to the latest migrations..."
supabase db reset

STATUS_JSON=$(supabase status -o env)
export NUXT_PUBLIC_SUPABASE_URL=$(echo "$STATUS_JSON" | sed -n 's/^API_URL="\(.*\)"/\1/p')
export NUXT_PUBLIC_SUPABASE_KEY=$(echo "$STATUS_JSON" | sed -n 's/^ANON_KEY="\(.*\)"/\1/p')
export NUXT_SUPABASE_SECRET_KEY=$(echo "$STATUS_JSON" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p')

if [ -z "$NUXT_PUBLIC_SUPABASE_URL" ] || [ -z "$NUXT_PUBLIC_SUPABASE_KEY" ] || [ -z "$NUXT_SUPABASE_SECRET_KEY" ]; then
  echo "Failed to extract Supabase env vars from 'supabase status -o env'" >&2
  exit 1
fi

echo "Using local Supabase at $NUXT_PUBLIC_SUPABASE_URL"

npm run test:e2e
