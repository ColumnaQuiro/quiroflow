import { fetchPracticeHubFile, PracticeHubFileDownloadFailed, PracticeHubFileUrlRefused } from '~/server/utils/practicehubFiles'
import { PracticeHubLinkExpired } from '~/utils/practicehubImport/types'

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

  // The URL check and the download are fetchPracticeHubFile's
  // (server/utils/practicehubFiles.ts), shared with the import job, which
  // stores the files itself. This only turns its refusals into answers.
  let file: { bytes: Uint8Array; contentType: string | null }
  try {
    file = await fetchPracticeHubFile(body.url)
  } catch (e) {
    if (e instanceof PracticeHubFileUrlRefused) throw createError({ statusCode: 400, statusMessage: e.message })
    // A signed URL is short-lived. An expired batch is recoverable by
    // re-listing the files, so say which it was rather than leaving the
    // client to guess from a bare 502. Every 403 says so, as it always has:
    // the browser's answer to it is the same re-list either way.
    if (e instanceof PracticeHubLinkExpired || (e instanceof PracticeHubFileDownloadFailed && e.status === 403)) {
      throw createError({ statusCode: 410, statusMessage: 'That file link has expired — list the files again to get fresh ones' })
    }
    if (e instanceof PracticeHubFileDownloadFailed) throw createError({ statusCode: 502, statusMessage: e.message })
    throw e
  }

  setHeader(event, 'Content-Type', file.contentType ?? 'application/octet-stream')
  return Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength)
})
