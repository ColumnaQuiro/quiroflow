// Nightly copy of every Supabase Storage object into a bucket outside
// Supabase.
//
// Supabase's own backups cover the DATABASE only. The dashboard says so
// outright ("Database backups do not include objects stored via the Storage
// API"), so on 13 Nov 2026 the clinics' files -- 14 GB of patient documents,
// photos, WhatsApp media and invoice PDFs, which have to be kept for years --
// had no copy anywhere. A file deleted by a bug, a mistaken click or a leaked
// key was gone. This closes that.
//
// What it does, per Supabase bucket, both sides read over the S3 protocol:
//
//   - copies an object when the backup does not have it, when the sizes
//     differ, or when Supabase's copy is newer than the backup's (an upsert
//     that overwrote it);
//   - NEVER deletes. A file removed from Supabase stays in the backup. The
//     backup bucket is versioned, so an overwrite keeps the previous version
//     too, and the IAM role this runs as is denied every delete -- a leaked
//     credential can add versions but cannot destroy what is there.
//
// It prints counts, never object keys. Keys carry the uploaded filename
// (`<account>/<patient>/<ts>-Informe ....pdf`), the repository is public, and
// so are its Actions logs.
//
// Environment:
//   SUPABASE_S3_ENDPOINT           https://<ref>.storage.supabase.co/storage/v1/s3
//   SUPABASE_S3_REGION             the project's region (eu-west-1)
//   SUPABASE_S3_ACCESS_KEY_ID      Storage -> S3 Configuration -> access keys
//   SUPABASE_S3_SECRET_ACCESS_KEY
//   BACKUP_BUCKET                  destination bucket name
//   BACKUP_REGION                  destination region (eu-south-2)
//   BACKUP_S3_ENDPOINT             optional; only to point at a local S3 in tests
//   BACKUP_ACCESS_KEY_ID           optional; otherwise the default AWS chain
//   BACKUP_SECRET_ACCESS_KEY         (in CI: the OIDC role the workflow assumes)
//   DRY_RUN=1                      list and compare, copy nothing
import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

const env = process.env
const required = ['SUPABASE_S3_ENDPOINT', 'SUPABASE_S3_REGION', 'SUPABASE_S3_ACCESS_KEY_ID', 'SUPABASE_S3_SECRET_ACCESS_KEY', 'BACKUP_BUCKET', 'BACKUP_REGION']
const missing = required.filter(name => !env[name])
if (missing.length) {
  console.error(`Missing environment: ${missing.join(', ')}`)
  process.exit(1)
}

const DRY_RUN = env.DRY_RUN === '1'
const CONCURRENCY = 8

const source = new S3Client({
  endpoint: env.SUPABASE_S3_ENDPOINT,
  region: env.SUPABASE_S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.SUPABASE_S3_ACCESS_KEY_ID, secretAccessKey: env.SUPABASE_S3_SECRET_ACCESS_KEY },
})

const backup = new S3Client({
  region: env.BACKUP_REGION,
  ...(env.BACKUP_S3_ENDPOINT ? { endpoint: env.BACKUP_S3_ENDPOINT, forcePathStyle: true } : {}),
  ...(env.BACKUP_ACCESS_KEY_ID
    ? { credentials: { accessKeyId: env.BACKUP_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_SECRET_ACCESS_KEY } }
    : {}),
})

async function listAll(client, Bucket, Prefix) {
  const objects = new Map()
  let ContinuationToken
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }))
    for (const o of page.Contents ?? []) objects.set(o.Key, { size: o.Size ?? 0, modified: o.LastModified })
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (ContinuationToken)
  return objects
}

function needsCopy(src, dst) {
  if (!dst) return true
  if (src.size !== dst.size) return true
  // The backup's LastModified is when WE wrote it, which is after Supabase's
  // copy was last written -- unless Supabase's was overwritten since.
  return src.modified && dst.modified && src.modified > dst.modified
}

async function copyOne(bucket, key) {
  const got = await source.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = await got.Body.transformToByteArray()
  await backup.send(new PutObjectCommand({
    Bucket: env.BACKUP_BUCKET,
    Key: `${bucket}/${key}`,
    Body: body,
    ContentLength: body.length,
    ContentType: got.ContentType,
    Metadata: { 'source-last-modified': got.LastModified?.toISOString() ?? '' },
  }))
  return body.length
}

async function pool(items, worker) {
  let next = 0
  const run = async () => {
    while (next < items.length) await worker(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run))
}

const mb = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const { Buckets = [] } = await source.send(new ListBucketsCommand({}))
let failedTotal = 0
let copiedTotal = 0
let listedTotal = 0

for (const { Name: bucket } of Buckets) {
  // Only possible in a local test that uses one S3 for both sides: never back
  // the backup up into itself.
  if (bucket === env.BACKUP_BUCKET && env.BACKUP_S3_ENDPOINT === env.SUPABASE_S3_ENDPOINT) continue
  const [src, dst] = await Promise.all([
    listAll(source, bucket),
    listAll(backup, env.BACKUP_BUCKET, `${bucket}/`),
  ])
  const dstByKey = new Map([...dst].map(([k, v]) => [k.slice(bucket.length + 1), v]))
  const todo = [...src].filter(([key, meta]) => needsCopy(meta, dstByKey.get(key))).map(([key]) => key)
  const onlyInBackup = [...dstByKey.keys()].filter(key => !src.has(key)).length

  let copied = 0
  let bytes = 0
  let vanished = 0
  const errors = new Map()
  if (!DRY_RUN) {
    await pool(todo, async (key) => {
      try {
        bytes += await copyOne(bucket, key)
        copied++
      }
      catch (err) {
        // Deleted between the listing and the download: nothing to copy, and
        // the next run will not list it again.
        if (err?.name === 'NoSuchKey') { vanished++; return }
        // Error NAME only. The message can quote the key.
        const name = err?.name ?? 'Error'
        errors.set(name, (errors.get(name) ?? 0) + 1)
      }
    })
  }
  const failed = [...errors.values()].reduce((a, b) => a + b, 0)
  failedTotal += failed
  copiedTotal += copied
  listedTotal += src.size

  const parts = [
    `${src.size} objects`,
    DRY_RUN ? `${todo.length} to copy` : `${copied} copied (${mb(bytes)})`,
    `${failed} failed`,
    `${onlyInBackup} only in backup`,
  ]
  if (vanished) parts.push(`${vanished} deleted mid-run`)
  console.log(`${bucket}: ${parts.join(', ')}`)
  for (const [name, count] of errors) console.log(`  ${name}: ${count}`)
}

console.log(DRY_RUN ? 'Dry run: nothing copied.' : `Done: ${copiedTotal} copied, ${failedTotal} failed.`)
if (failedTotal) process.exit(1)
// Production has thousands of files. Listing none means this is pointed at
// the wrong project or the keys see nothing -- a green run that backed up
// nothing is the failure this whole script exists to prevent.
if (!listedTotal && env.ALLOW_EMPTY_SOURCE !== '1') {
  console.error('Supabase listed no objects at all. Wrong SUPABASE_S3_ENDPOINT or access key?')
  process.exit(1)
}
