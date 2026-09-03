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

# TestFlight rejects an upload whose CFBundleVersion isn't strictly
# higher than what's already there for this MARKETING_VERSION, and
# CURRENT_PROJECT_VERSION in project.pbxproj is a value checked into
# git -- static until someone remembers to bump it by hand. That's
# exactly what silently failed two builds in a row after a build 15
# upload: the next two archives still carried CURRENT_PROJECT_VERSION
# 15 from git and Xcode Cloud's "Prepare Build for App Store Connect"
# step rejected both with the generic "Error while uploading build.
# This might be retried." (no louder failure, no red flag beyond that).
# A UTC-timestamp build number is always higher than anything before
# it, regardless of what's committed or already on TestFlight, so this
# never needs a manual bump again. Runs before `cd mobile` -- agvtool
# operates on the Xcode project in the current directory.
cd "$CI_PRIMARY_REPOSITORY_PATH/mobile/ios/App"
agvtool new-version -all "$(date -u +%Y%m%d%H%M)"

# Build 4 failed with exit 127 ("command not found") right here -- this
# ci_scripts/*.sh runs as a plain non-interactive /bin/sh, which doesn't
# source whatever profile/version-manager setup would normally put npm on
# PATH. Homebrew itself is documented as preinstalled on every Xcode Cloud
# image, so install Node through that directly instead of assuming npm is
# already reachable.
if ! command -v npm >/dev/null 2>&1; then
  brew install node
fi

# mobile/ imports some shared code straight from the repo root (e.g.
# utils/appointmentOverrides.ts) rather than duplicating it, so the root
# app's own .nuxt/tsconfig.json needs to exist too, or Vite's tsconfig
# lookup for those root-level files fails the same way it did for mobile's
# own files before mobile/tsconfig.json existed -- `extends` pointing at a
# .nuxt directory nobody ever generated. Running the root app's own `npm
# ci`/`nuxt prepare` to produce that file turned out to be its own rabbit
# hole (oxc-walker's native parser failing to resolve on a clean CI
# install) for a file esbuild only needs to parse, not type-check against
# real project info -- an empty stub satisfies the `extends` resolution
# just as well, confirmed by building mobile with only this in place.
mkdir -p "$CI_PRIMARY_REPOSITORY_PATH/.nuxt"
echo '{}' > "$CI_PRIMARY_REPOSITORY_PATH/.nuxt/tsconfig.json"

cd "$CI_PRIMARY_REPOSITORY_PATH/mobile"

export NUXT_PUBLIC_SUPABASE_URL="https://oyaprkfurtuujdfafptw.supabase.co"
export NUXT_PUBLIC_SUPABASE_KEY="sb_publishable_YcvVhzmzvUvhf4vfv2edKg_PmQrl7To"

npm ci
npm run cap:sync
