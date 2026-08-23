// WKWebView's capacitor://localhost scheme silently fails to load
// <script type="module" crossorigin> tags -- the script never runs at all
// (blank screen, no console error). Vite adds `crossorigin` unconditionally;
// strip it post-build since this app only ever ships inside the Capacitor
// WebView, never cross-origin. See mobile/nuxt.config.ts for context.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..', '.output', 'public')
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.html')) continue
  const path = join(dir, file)
  const contents = readFileSync(path, 'utf8')
  const stripped = contents.replace(/ crossorigin/g, '')
  if (stripped !== contents) writeFileSync(path, stripped)
}
