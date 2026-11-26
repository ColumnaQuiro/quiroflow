import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database.types'
import { planImageShrink } from '../../utils/imageShrink'
import { PracticeHubFileTooLarge, PracticeHubLinkExpired, type PracticeHubFileServices, type PracticeHubLargeCopy } from '../../utils/practicehubImport/types'
import { sniffImageType } from '../../utils/practicehubProfilePhotos'
import { compressStoredFile } from './patientFileProcessing'

// The server's side of copying PracticeHub's files: one download, shared by
// /api/import/practicehub-file (which hands the bytes to a browser) and the
// import job's photo and file steps (utils/practicehubImport/photos.ts,
// files.ts), which store them here themselves.
//
// Relative imports, and sharp loaded inside the one function that uses it:
// everything under server/utils is bundled into the chunk every request
// evaluates, so a top-level import of sharp made every cold start pay ~800 ms
// for it (see CLAUDE.md).

/** The URL handed in is not one this will fetch. The endpoint answers 400 with the message. */
export class PracticeHubFileUrlRefused extends Error {}

/** PracticeHub's S3 answered with something other than the file. */
export class PracticeHubFileDownloadFailed extends Error {
  readonly status: number
  constructor(status: number) {
    super(`PracticeHub file download failed (HTTP ${status})`)
    this.status = status
  }
}

/**
 * The download a job allows one file. Server to S3 is quick -- the slowest
 * download measured, through this server and on to a clinic's browser, was
 * 20 s -- and a slice works for 35 s inside a function cut off at 60, with the
 * upload, the row and compression still to come after the bytes. 15 s leaves
 * room for those, and a file that needs longer is counted as failed and tried
 * again next run rather than taking the slice down with it.
 */
export const PRACTICEHUB_FILE_TIMEOUT_MS = 15_000

/**
 * Fetches one of PracticeHub's pre-signed S3 links.
 *
 * An authenticated endpoint that fetches whatever URL it is handed is still a
 * way to reach things only this server can see -- cloud metadata, anything on
 * a private network. PracticeHub hands out S3 links, so that is all this will
 * follow: https, on amazonaws.com, and no redirects.
 *
 * Throws PracticeHubFileUrlRefused for any other URL, PracticeHubLinkExpired
 * when S3 says the link has expired, and PracticeHubFileDownloadFailed for
 * any other refusal -- a 403 included, when S3 says why and it is not the
 * expiry (see below).
 */
export async function fetchPracticeHubFile(url: string, options: { timeoutMs?: number } = {}): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const res = await fetch(practiceHubS3Target(url), {
    redirect: 'error',
    ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
  })
  await refusePracticeHubS3(res)
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') }
}

/** The URL, if it is one of PracticeHub's S3 links (https, *.amazonaws.com); PracticeHubFileUrlRefused otherwise. */
export function practiceHubS3Target(url: string): string {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new PracticeHubFileUrlRefused('url is not a valid URL')
  }
  const host = target.hostname.toLowerCase()
  if (target.protocol !== 'https:' || !(host === 'amazonaws.com' || host.endsWith('.amazonaws.com'))) {
    throw new PracticeHubFileUrlRefused('Only PracticeHub S3 file URLs can be fetched')
  }
  return target.toString()
}

/** Throws what S3's answer means when it is not the file: PracticeHubLinkExpired or PracticeHubFileDownloadFailed. */
export async function refusePracticeHubS3(res: Response): Promise<void> {
  if (res.status === 403) {
    // S3 answers 403 both for a signed link past its time ("Request has
    // expired") and for an object that is not there, when the signer may not
    // list the bucket ("Access Denied"). Only the first is cured by reading
    // the list again; the job does that on PracticeHubLinkExpired, so calling
    // a missing file expired would have it read the list and fail on the same
    // file again, for ever. A 403 that does not say why is taken as expiry,
    // which is what it has always meant here.
    const body = await res.text().catch(() => '')
    if (/<Code>/i.test(body) && !/expired/i.test(body)) throw new PracticeHubFileDownloadFailed(403)
    throw new PracticeHubLinkExpired()
  }
  if (!res.ok) throw new PracticeHubFileDownloadFailed(res.status)
}

/** The JPEG quality the browser's canvas shrink uses (utils/imageShrink.ts). */
const PHOTO_JPEG_QUALITY = 85

/**
 * A profile photo made what the browser importer makes of it on a canvas
 * (shrinkImageForUpload(…, 'photo')): upright by its EXIF orientation, the
 * SHORT side at most 256 px (planImageShrink -- every place draws it as an
 * object-cover circle 64 px across at most), white behind any transparency,
 * JPEG at quality 85. Never enlarged.
 *
 * Null when the bytes are not a picture (one PracticeHub "photo" was a 2 MB
 * PDF). The original bytes, as their own type, when sharp cannot decode them
 * or re-encoding would not make a JPEG or PNG at its size any smaller -- what
 * the browser does too, rather than refusing the photo.
 */
export async function shrinkPracticeHubPhoto(bytes: Uint8Array): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const image = sniffImageType(bytes)
  if (!image) return null
  const original = { bytes, contentType: image.contentType }
  try {
    const { default: sharp } = await import('sharp')
    const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const meta = await sharp(input).metadata()
    if (!meta.width || !meta.height) return original
    const plan = planImageShrink('photo', meta.width, meta.height, image.contentType, false)
    // metadata() reports the frame as stored; an orientation of 5-8 is a
    // quarter turn, so the size after rotate() has the sides swapped.
    const turned = (meta.orientation ?? 1) >= 5
    const out = await sharp(input)
      .rotate()
      .resize(turned ? plan.height : plan.width, turned ? plan.width : plan.height, { fit: 'fill' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: PHOTO_JPEG_QUALITY })
      .toBuffer()
    const sameSize = plan.width === meta.width && plan.height === meta.height
    if (out.length >= bytes.length && (image.contentType === 'image/jpeg' || image.contentType === 'image/png') && sameSize) return original
    return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), contentType: plan.type }
  } catch {
    return original
  }
}

/** What the import job's photo and file steps download and store with, for one account. */
export function practiceHubFileServices(admin: SupabaseClient<Database>, accountId: string): PracticeHubFileServices {
  return {
    fetch: (url) => fetchPracticeHubFile(url, { timeoutMs: PRACTICEHUB_FILE_TIMEOUT_MS }),
    compressFile: (fileId) => compressStoredFile(admin, accountId, fileId),
    shrinkPhoto: shrinkPracticeHubPhoto,
  }
}
