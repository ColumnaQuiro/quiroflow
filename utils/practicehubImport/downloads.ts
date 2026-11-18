import { DeadlineError, withDeadline } from '~/utils/withDeadline'
import { PracticeHubLinkExpired } from '~/utils/practicehubImport/types'

// How the two steps that copy bytes (photos.ts, files.ts) work through their
// queue inside a slice: a few at a time, nothing new started once the slice
// says stop or a link has expired, and a file in flight left to finish.

/**
 * The longest one file may take to download and store, on the server. The
 * browser importer allowed three minutes (FILE_DEADLINE_MS in
 * PracticeHubFilesImporter.vue), for a tab Safari can freeze mid-request; a
 * slice has no such pause, and it runs 35 s inside a function cut off at 60,
 * so a file that has not been stored in 20 s is counted as failed and the
 * queue moves on. The next run retries it, and its fixed storage path keeps
 * that from leaving a second copy behind.
 */
export const PRACTICEHUB_FILE_DEADLINE_MS = 20_000

/** What a download that ran out of time says, in the person's language. */
export function practiceHubDownloadErrorText(e: unknown, t: (en: string, es: string) => string): string {
  // DeadlineError is the per-file deadline above; TimeoutError is the
  // download's own (server/utils/practicehubFiles.ts).
  if (e instanceof DeadlineError || (e as { name?: string } | null)?.name === 'TimeoutError') {
    return t('no answer in time', 'sin respuesta a tiempo')
  }
  return e instanceof Error ? e.message : String(e)
}

/**
 * Runs `work` over `items`, `concurrency` at a time, each under
 * PRACTICEHUB_FILE_DEADLINE_MS. Nothing new starts once `shouldStop` says so
 * or a download has met an expired link; whatever is in flight then finishes.
 *
 * `progress` counts every item finished -- stored, failed or skipped as not
 * an image -- and never one that met an expired link: that one is not done,
 * the job reads the list again and the next run finds it still missing.
 *
 * `work` may hand back a follow-up -- compressing what it stored -- which
 * runs after the item's deadline rather than under it, so an item already
 * stored is never reported as failed because what came after it was slow.
 * The follow-up's errors are its own to handle.
 *
 * Returns whether a link expired.
 */
export async function eachPracticeHubDownload<T>(
  items: T[],
  options: { concurrency: number; shouldStop: () => boolean; progress: (done: number) => void },
  // Resolves to nothing, or to a follow-up (compression) to run after the
  // file's deadline: a file already stored is never reported as failed.
  work: (item: T) => Promise<unknown>,
  failed: (item: T, e: unknown) => void,
): Promise<boolean> {
  let next = 0
  let done = 0
  let expired = false
  const worker = async () => {
    while (next < items.length && !expired && !options.shouldStop()) {
      const item = items[next++]!
      try {
        const then: unknown = await withDeadline(() => work(item), PRACTICEHUB_FILE_DEADLINE_MS)
        if (typeof then === 'function') await Promise.resolve((then as () => Promise<void>)()).catch(() => {})
      } catch (e) {
        if (e instanceof PracticeHubLinkExpired) {
          expired = true
          continue
        }
        failed(item, e)
      }
      options.progress(++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, items.length) }, worker))
  return expired
}
