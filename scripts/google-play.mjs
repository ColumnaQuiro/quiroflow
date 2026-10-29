// The Google Play side of .github/workflows/android.yml, talking to the Play
// Developer API directly rather than through a marketplace action. The
// service-account key can release the app, so only this file, which is
// reviewed here, ever sees it. Node's own crypto and fetch are enough: no
// dependencies, nothing to install in front of it.
//
//   node scripts/google-play.mjs next-version-code
//     Prints the versionCode the next bundle must carry: one more than the
//     highest Play has ever been given, on any track.
//
//   node scripts/google-play.mjs upload <app.aab> <versionCode> [notes]
//     Uploads the bundle and makes it the internal testing release.
//
// Play refuses a versionCode that is not strictly higher than every one
// already uploaded, including bundles that were never released and releases
// that were discarded, so the code is read from Play rather than from git or
// a run counter. Hand uploads and CI then cannot collide.
//
// The track is hard-coded to `internal`. Play publishes a production release
// as soon as it is approved (managed publishing is off), so promoting a build
// to production stays a person's decision in Play Console, and the service
// account should only hold "release to testing tracks" anyway.
//
// Reads the service-account JSON from PLAY_SERVICE_ACCOUNT_JSON.
import { createSign } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

const PACKAGE = 'com.quiroflow.app'
const TRACK = 'internal'
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`
const UPLOAD_API = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

function serviceAccount() {
  const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON
  if (!raw) fail('PLAY_SERVICE_ACCOUNT_JSON is empty')
  try {
    const key = JSON.parse(raw)
    if (!key.client_email || !key.private_key) throw new Error('missing client_email or private_key')
    return key
  } catch (error) {
    // Never echo the value: it is a private key.
    fail(`PLAY_SERVICE_ACCOUNT_JSON is not a service-account key file (${error.message})`)
  }
}

// OAuth for a service account: a JWT signed with its own key, exchanged for an
// access token (https://developers.google.com/identity/protocols/oauth2/service-account).
async function accessToken() {
  const key = serviceAccount()
  const tokenUri = key.token_uri || 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token) {
    fail(`Google refused the service account (${response.status}): ${body.error_description || body.error || 'no detail'}`)
  }
  return body.access_token
}

function client(token) {
  return async function call(method, url, { body, headers = {}, raw = false } = {}) {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    })
    if (!response.ok) {
      const detail = await response.json().then((b) => b.error?.message).catch(() => null)
      const error = new Error(`${method} ${url.replace(API, '').replace(UPLOAD_API, '')} -> ${response.status}: ${detail || response.statusText}`)
      error.status = response.status
      error.detail = detail || ''
      throw error
    }
    return raw === 'response' ? response : response.status === 204 ? null : response.json()
  }
}

async function nextVersionCode() {
  const call = client(await accessToken())
  const { id } = await call('POST', `${API}/edits`, { body: {} })
  try {
    const [bundles, apks, tracks] = await Promise.all([
      call('GET', `${API}/edits/${id}/bundles`),
      call('GET', `${API}/edits/${id}/apks`),
      call('GET', `${API}/edits/${id}/tracks`),
    ])
    const codes = [
      ...(bundles.bundles ?? []).map((b) => b.versionCode),
      ...(apks.apks ?? []).map((a) => a.versionCode),
      ...(tracks.tracks ?? []).flatMap((t) => (t.releases ?? []).flatMap((r) => r.versionCodes ?? [])),
    ].map(Number).filter(Number.isFinite)
    // Every bundle QuiroFlow has ever shipped is an AAB on Play, so an empty
    // list means the API answered for something else, not "start at 1".
    if (!codes.length) fail(`Play listed no bundles at all for ${PACKAGE}; refusing to guess a versionCode`)
    const highest = Math.max(...codes)
    console.error(`highest versionCode on Play: ${highest}`)
    return highest + 1
  } finally {
    // The edit was only for reading; leave nothing open.
    await call('DELETE', `${API}/edits/${id}`).catch(() => {})
  }
}

async function upload(file, versionCode, notes) {
  const size = statSync(file).size
  const call = client(await accessToken())
  const { id } = await call('POST', `${API}/edits`, { body: {} })

  // Resumable upload: ask for a session URL, then send the bundle to it in one
  // PUT. A plain `uploadType=media` request is meant for small files.
  const session = await call('POST', `${UPLOAD_API}/edits/${id}/bundles?uploadType=resumable`, {
    raw: 'response',
    headers: {
      'x-upload-content-type': 'application/octet-stream',
      'x-upload-content-length': String(size),
    },
  })
  const location = session.headers.get('location')
  if (!location) fail('Play did not return an upload session URL')
  const bundle = await call('PUT', location, {
    raw: true,
    body: readFileSync(file),
    headers: { 'content-type': 'application/octet-stream' },
  })
  if (Number(bundle.versionCode) !== versionCode) {
    fail(`Play read versionCode ${bundle.versionCode} from the bundle, expected ${versionCode}`)
  }
  console.log(`uploaded versionCode ${bundle.versionCode} (sha256 ${bundle.sha256})`)

  await call('PUT', `${API}/edits/${id}/tracks/${TRACK}`, {
    body: {
      track: TRACK,
      releases: [{
        versionCodes: [String(versionCode)],
        status: 'completed',
        // Play caps release notes at 500 characters per language.
        ...(notes ? { releaseNotes: [{ language: 'es-ES', text: notes.slice(0, 500) }] } : {}),
      }],
    },
  })

  try {
    await call('POST', `${API}/edits/${id}:commit`)
  } catch (error) {
    // When the app has other changes awaiting review, Play will not send this
    // edit for review on its own and says so. The edit is still open, so commit
    // it again leaving the review step to Play Console.
    if (error.status !== 400 || !/changesNotSentForReview/i.test(error.detail)) throw error
    console.log('Play will not send this for review automatically; committing it as "not sent for review"')
    await call('POST', `${API}/edits/${id}:commit?changesNotSentForReview=true`)
  }
  console.log(`versionCode ${versionCode} is the ${TRACK} testing release`)
}

const [command, ...args] = process.argv.slice(2)
try {
  if (command === 'next-version-code') {
    console.log(await nextVersionCode())
  } else if (command === 'upload') {
    const [file, code, notes] = args
    if (!file || !Number.isInteger(Number(code))) fail('usage: upload <app.aab> <versionCode> [notes]')
    await upload(file, Number(code), notes)
  } else {
    fail('usage: google-play.mjs next-version-code | upload <app.aab> <versionCode> [notes]')
  }
} catch (error) {
  fail(error.message)
}
