#!/usr/bin/env bash
# Runs the given command under the Node version this repo's .nvmrc pins
# (currently 22) if nvm is available, regardless of what a given shell
# happens to default to -- Nuxt's route-metadata step (oxc-walker) does a
# plain CJS require() of oxc-parser, which ships ESM-only, and require(esm)
# only works from Node 22+. Under an older default Node this crashes every
# nuxt dev/build/prepare on startup with no hint that the fix is a Node
# version, not a broken dependency. Falls through to whatever Node is
# already on PATH if nvm isn't installed, rather than failing outright.
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  nvm use --silent
fi
exec "$@"
