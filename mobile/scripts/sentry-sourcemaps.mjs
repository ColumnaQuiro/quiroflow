// Runs after `nuxt generate` (package.json's build). A JavaScript error from
// the app arrives in Sentry as a stack through minified bundles, which says
// nothing. With the source maps uploaded it reads as the .vue/.ts line that
// threw.
//
// Only when SENTRY_AUTH_TOKEN is set -- Xcode Cloud's secret, or the shell
// building the Android release -- which is also when nuxt.config.ts asks
// Vite for maps at all. `inject` writes a debug id into each bundle and its
// map, which is how Sentry pairs them: no release name or URL to agree on.
// The maps are then deleted, so they never ship inside the app.
//
// A failed upload does not fail the build: the app is fine, only its JS
// stacks in Sentry are not. The warning is in the build log.
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..', '.output', 'public')
const maps = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.map')).map((f) => join(dir, f))

if (process.env.SENTRY_AUTH_TOKEN && maps.length) {
  const cli = join(import.meta.dirname, '..', 'node_modules', '.bin', 'sentry-cli')
  const run = (...args) => execFileSync(cli, args, { stdio: 'inherit' })
  try {
    run('sourcemaps', 'inject', dir)
    run('sourcemaps', 'upload', '--org', 'quiroflow', '--project', 'quiroflow-app', dir)
  } catch (error) {
    console.warn(`warning: source maps not uploaded to Sentry: ${error.message}`)
  }
}

for (const map of maps) rmSync(map)
