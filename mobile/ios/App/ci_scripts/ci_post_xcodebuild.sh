#!/bin/sh
set -e

# A native crash reaches Sentry (project quiroflow-app) as bare addresses
# until it has the dSYMs of the build that crashed: Swift, Firebase and
# Capacitor frames then read as functions and lines. Xcode Cloud keeps the
# archive's dSYMs to itself, so they are uploaded here, after the archive
# and before anyone can have installed the build.
#
# sentry-cli is mobile/'s dev dependency, already installed by
# ci_post_clone.sh's `npm ci`. Sentry pairs a crash with its dSYM by the
# binary's UUID, so nothing here has to agree with a version or build number.
#
# Never fails the build: a missing token or a refused upload means a crash
# from this build reads as addresses, which is no reason to throw the build
# away. The cost is that nothing goes red -- check that the archive log says
# "Uploaded" after changing anything here.

if [ "$CI_XCODEBUILD_ACTION" != "archive" ] || [ -z "$CI_ARCHIVE_PATH" ]; then
  exit 0
fi

if [ -z "$SENTRY_AUTH_TOKEN" ]; then
  echo "warning: SENTRY_AUTH_TOKEN is not set in the workflow environment; dSYMs not uploaded to Sentry"
  exit 0
fi

"$CI_PRIMARY_REPOSITORY_PATH/mobile/node_modules/.bin/sentry-cli" debug-files upload \
  --org quiroflow --project quiroflow-app \
  "$CI_ARCHIVE_PATH/dSYMs" \
  || echo "warning: the dSYM upload to Sentry failed; crashes from this build will not be symbolicated"
