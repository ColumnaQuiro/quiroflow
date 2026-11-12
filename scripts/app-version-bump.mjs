// The check behind .github/workflows/app-version-bump.yml: has the App Store
// shipped the version the repo is still building?
//
// Once a marketing version is approved, its "train" closes. Every Xcode Cloud
// build still carrying it archives fine and then fails at "Preparing build for
// App Store Connect" (ITMS-90186), so after every approval someone had to
// notice and bump MARKETING_VERSION by hand. This happened after nearly every
// release from 1.3 to 1.29, usually found out because builds had already
// failed.
//
//   node scripts/app-version-bump.mjs
//     Compares the repo's MARKETING_VERSION with the version live on the App
//     Store. Prints a summary, and when GITHUB_OUTPUT is set writes
//     `current`, `live`, `next` and `needed` (true/false) to it.
//
//   node scripts/app-version-bump.mjs --apply <next> [versionCode]
//     Writes <next> into every MARKETING_VERSION in project.pbxproj and into
//     build.gradle's hand-build versionName default, and the versionCode
//     default when given.
//
// The live version comes from Apple's public lookup API, so this needs no App
// Store Connect key. That API only knows what is ON SALE: a version approved
// with a MANUAL release has already closed its train but is not on sale yet,
// and this cannot see it. The workflow's manual run with `force` covers that.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'

const APP_ID = '6805009978'
// Both stores are Spain-only, and the lookup answers nothing for a country
// the app is not sold in.
const COUNTRY = 'es'
const PBXPROJ = 'mobile/ios/App/App.xcodeproj/project.pbxproj'
const GRADLE = 'mobile/android/app/build.gradle'

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

function parse(version) {
  if (!/^\d+\.\d+$/.test(version)) fail(`"${version}" is not MAJOR.MINOR`)
  return version.split('.').map(Number)
}

function compare(a, b) {
  const [x, y] = [parse(a), parse(b)]
  return x[0] - y[0] || x[1] - y[1]
}

// 1.9 -> 1.10, not 2.0: that is what every release so far has done. A jump
// to 2.0 stays a person's decision, made by editing the PR this opens.
function next(version) {
  const [major, minor] = parse(version)
  return `${major}.${minor + 1}`
}

function repoVersion() {
  const found = [...readFileSync(PBXPROJ, 'utf8').matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1])
  const distinct = [...new Set(found)]
  if (found.length === 0) fail(`no MARKETING_VERSION in ${PBXPROJ}`)
  // The app and its widget extension each carry one, Debug and Release.
  // Apple refuses an extension whose version differs from its app's.
  if (distinct.length !== 1) fail(`MARKETING_VERSION differs between targets: ${distinct.join(', ')}`)
  return distinct[0]
}

async function liveVersion() {
  const url = `https://itunes.apple.com/lookup?id=${APP_ID}&country=${COUNTRY}&_=${Date.now()}`
  const response = await fetch(url)
  if (!response.ok) fail(`App Store lookup answered ${response.status}`)
  const body = await response.json()
  const version = body.results?.[0]?.version
  if (!version) fail(`App Store lookup returned no version: ${JSON.stringify(body).slice(0, 300)}`)
  return version
}

function apply(version, code) {
  parse(version)
  const pbx = readFileSync(PBXPROJ, 'utf8')
  const bumped = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  if (bumped === pbx) fail(`${PBXPROJ} already says ${version}`)
  writeFileSync(PBXPROJ, bumped)

  let gradle = readFileSync(GRADLE, 'utf8')
  const nameLine = /(findProperty\('quiroflowVersionName'\) \?: ')[^']+(')/
  if (!nameLine.test(gradle)) fail(`no versionName default in ${GRADLE}`)
  gradle = gradle.replace(nameLine, `$1${version}$2`)
  if (code) {
    if (!/^\d+$/.test(code)) fail(`versionCode "${code}" is not a number`)
    const codeLine = /(findProperty\('quiroflowVersionCode'\) \?: ')\d+(')/
    if (!codeLine.test(gradle)) fail(`no versionCode default in ${GRADLE}`)
    gradle = gradle.replace(codeLine, `$1${code}$2`)
  }
  writeFileSync(GRADLE, gradle)
  console.log(`MARKETING_VERSION and versionName -> ${version}${code ? `, versionCode default -> ${code}` : ''}`)
}

const args = process.argv.slice(2)
if (args[0] === '--apply') {
  if (!args[1]) fail('usage: --apply <version> [versionCode]')
  apply(args[1], args[2])
} else {
  const current = repoVersion()
  const live = await liveVersion()
  const order = compare(current, live)
  // Ahead: the bump already happened and the store has not caught up, which
  // is the normal state between releases. Behind should not happen; say so
  // rather than bumping from a number nobody chose.
  if (order < 0) fail(`the repo builds ${current} but the App Store already has ${live}`)
  const needed = order === 0
  const result = { current, live, next: next(current), needed }
  console.log(needed
    ? `${live} is live on the App Store and the repo still builds it: bump to ${result.next}`
    : `the repo builds ${current}, the App Store has ${live}: nothing to do`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(result).map(([k, v]) => `${k}=${v}\n`).join(''))
  }
}
