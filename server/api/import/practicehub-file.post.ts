// Fetches one PracticeHub file's bytes so the browser can store it.
//
// /api/files gives every attachment a pre-signed S3 URL, but that bucket sends
// no CORS headers for our origin, so the browser cannot read it -- the same
// reason practicehub-proxy.post.ts exists for the JSON API. This crosses that
// gap and nothing else: the bytes come straight back and the client uploads
// them to Storage under its own session, so the write stays inside the RLS the
// web app is already bound by rather than being done here with elevated rights.
//
// Why this replaced a browser-automation script: the assumption was that
// PracticeHub had no file API at all and the only way to a file's bytes was
// clicking "View" in a logged-in browser. It does have one. The script drove a
// real Chromium through a human's PracticeHub session, searching each patient
// by surname -- 13 seconds per patient and 21 failures in 135 on a measured
// run, most of them timeouts on the search table.
export default defineEventHandler(async (event) => {
  await requireSettingsPermission(event, 'data_admin')

  const body = await readBody<{ url: string }>(event)
  if (!body?.url) {
    throw createError({ statusCode: 400, statusMessage: 'url is required' })
  }

  // An authenticated endpoint that fetches whatever URL it is handed is still
  // a way to reach things only this server can see -- cloud metadata, anything
  // on a private network. PracticeHub hands out S3 links, so that is all this
  // will follow.
  let target: URL
  try {
    target = new URL(body.url)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'url is not a valid URL' })
  }
  const host = target.hostname.toLowerCase()
  if (target.protocol !== 'https:' || !(host === 'amazonaws.com' || host.endsWith('.amazonaws.com'))) {
    throw createError({ statusCode: 400, statusMessage: 'Only PracticeHub S3 file URLs can be fetched' })
  }

  const res = await fetch(target.toString(), { redirect: 'error' })
  if (!res.ok) {
    // A signed URL is short-lived -- the ones seen carry roughly a day. An
    // expired batch is recoverable by re-listing the files, so say which it
    // was rather than leaving the client to guess from a bare 502.
    throw createError({
      statusCode: res.status === 403 ? 410 : 502,
      statusMessage:
        res.status === 403
          ? 'That file link has expired — list the files again to get fresh ones'
          : `PracticeHub file download failed (HTTP ${res.status})`,
    })
  }

  setHeader(event, 'Content-Type', res.headers.get('content-type') ?? 'application/octet-stream')
  return Buffer.from(await res.arrayBuffer())
})
