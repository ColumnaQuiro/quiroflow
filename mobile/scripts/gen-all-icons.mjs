// Regenerates every app-icon file for both platforms from gen-icon.mjs.
// Run after changing the brand mark's geometry in gen-icon.mjs, then
// `npx cap sync` to pick up the iOS change (Android's res/ files are read
// directly by Gradle, no sync needed).
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const genIcon = join(here, 'gen-icon.mjs')
const root = join(here, '..')

function gen(size, outPath, fgOnly = false) {
  const args = [genIcon, String(size), outPath]
  if (fgOnly) args.push('fg-only')
  execFileSync('node', args, { stdio: 'inherit' })
}

gen(1024, join(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'))

const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
for (const [density, size] of Object.entries(densities)) {
  const dir = join(root, `android/app/src/main/res/mipmap-${density}`)
  gen(size, join(dir, 'ic_launcher.png'))
  gen(size, join(dir, 'ic_launcher_round.png'))
  gen(size, join(dir, 'ic_launcher_foreground.png'), true)
}
