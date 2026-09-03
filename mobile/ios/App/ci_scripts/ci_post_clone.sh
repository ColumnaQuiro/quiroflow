#!/bin/sh
set -e

# Xcode Cloud only clones the git repo -- it never runs this app's own web
# build or `pod install`. Locally, `npm run cap:sync` (nuxt generate + cap
# sync) produces three things that are all gitignored on purpose (they're
# build output, not source): mobile/ios/App/App/public (the web bundle
# Capacitor loads), mobile/ios/App/Pods (and its generated .xcconfig files,
# which is exactly what a fresh Xcode Cloud checkout is missing -- the
# archive step fails looking for Pods-App.release.xcconfig before this
# script ever runs), and mobile/.env. Reproducing all three here is what
# makes the Xcode Cloud clone buildable at all.
#
# NUXT_PUBLIC_SUPABASE_URL/KEY are the Supabase *anon* (publishable) key --
# safe to inline here the same way mobile/.env.example already documents
# them as public values, not a secret needing Xcode Cloud's own encrypted
# environment variable store.
# Without a UTF-8 locale, CocoaPods (run below via `cap sync`) crashes on
# `String#unicode_normalize` before it gets anywhere near installing pods --
# hit this exact failure running the same sync locally.
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Build 4 failed with exit 127 ("command not found") right here -- this
# ci_scripts/*.sh runs as a plain non-interactive /bin/sh, which doesn't
# source whatever profile/version-manager setup would normally put npm on
# PATH. Homebrew itself is documented as preinstalled on every Xcode Cloud
# image, so install Node through that directly instead of assuming npm is
# already reachable.
if ! command -v npm >/dev/null 2>&1; then
  brew install node
fi

cd "$CI_PRIMARY_REPOSITORY_PATH/mobile"

export NUXT_PUBLIC_SUPABASE_URL="https://oyaprkfurtuujdfafptw.supabase.co"
export NUXT_PUBLIC_SUPABASE_KEY="sb_publishable_YcvVhzmzvUvhf4vfv2edKg_PmQrl7To"

npm ci
npm run cap:sync
