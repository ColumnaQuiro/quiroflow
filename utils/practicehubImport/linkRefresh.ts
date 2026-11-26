import type { ImportJobProgress } from '~/utils/importJobReport'

// When a downloading step (profile photos, files) reads its link list again.
// PracticeHub's file links are pre-signed S3 URLs that lapse, so the step
// works from a list read fresh just now (PRACTICEHUB_LINK_LISTS), and reads
// it once more when the links grow old or one is refused as expired.
//
// These are the decisions only, kept apart from practicehubImportJob.ts so
// they can be tested without a database.

export type PracticeHubLinkState = NonNullable<ImportJobProgress['links']>

/**
 * A link list read this long ago is read again before more is downloaded
 * from it. PracticeHub's links lasted about an hour when the sync was written
 * (this was 30 minutes); on 25 Nov 2026 they lasted ten -- `Expires` was the
 * read plus 600 s -- so a sync's links had all lapsed twenty minutes before it
 * thought of reading them again. Seven minutes from the end of the read
 * leaves a slice's length to spare before the first page's links lapse, on a
 * clinic whose list takes a minute or two to read. A clinic whose list takes
 * longer still meets expired links, and the lapse below handles that.
 */
export const PRACTICEHUB_LINKS_MAX_AGE_MS = 7 * 60 * 1000

/** Lapses in a row, with no file stored since the last, before a downloading step gives up. */
export const PRACTICEHUB_MAX_EMPTY_LINK_REFRESHES = 3

/** Whether the step may download from the links it holds without reading the list again. */
export function practiceHubLinksFresh(links: PracticeHubLinkState | undefined, now: number): boolean {
  if (!links?.readAt || links.lapsed) return false
  return now - Date.parse(links.readAt) < PRACTICEHUB_LINKS_MAX_AGE_MS
}

/**
 * Whether reading the list starts a new pass, rather than carrying on with a
 * read a previous slice left part way. A read that finished (readAt) is never
 * carried on: its pages hold the old links.
 */
export function practiceHubLinksStartNewRead(links: PracticeHubLinkState | undefined): boolean {
  return !links?.pass || !!links.readAt
}

/** The state a new read of the list starts from. `refreshes` carries over: it counts across reads. */
export function practiceHubLinksNewRead(links: PracticeHubLinkState | undefined, pass: string): PracticeHubLinkState {
  return {
    pass, listIndex: 0, page: 1, pagesRead: {}, records: 0, done: 0,
    ...(links?.refreshes ? { refreshes: links.refreshes } : {}),
  }
}

/**
 * After a slice that met an expired link: the list is to be read anew, and
 * the step gives up once that has happened PRACTICEHUB_MAX_EMPTY_LINK_REFRESHES
 * times with no file stored in between (S3 answers 403 for more than expiry,
 * and a clinic whose list is slow to read could lap its own links).
 *
 * The lapse keeps readAt and says `lapsed`. Clearing readAt instead, which is
 * what this did until 26 Nov 2026, left a finished read looking like one
 * still under way: the next slice "carried on" with it, found nothing left to
 * read and downloaded from the same expired links -- three times in under
 * half a minute -- and the step stopped with most files still in PracticeHub.
 */
export function practiceHubLinksAfterLapse(
  links: PracticeHubLinkState | undefined,
  storedThisSlice: boolean,
): { links: PracticeHubLinkState; giveUp: boolean } {
  const refreshes = storedThisSlice ? 0 : (links?.refreshes ?? 0) + 1
  return { links: { ...links, lapsed: true, refreshes }, giveUp: refreshes >= PRACTICEHUB_MAX_EMPTY_LINK_REFRESHES }
}

/**
 * After a slice that met no expired link. Storing anything clears the count
 * of lapses: the slice that meets an expired link has usually stored nothing
 * itself, so counting only that slice would give up three lapses in, however
 * many files were stored in between.
 */
export function practiceHubLinksAfterSlice(links: PracticeHubLinkState | undefined, storedThisSlice: boolean): PracticeHubLinkState | undefined {
  return storedThisSlice && links?.refreshes ? { ...links, refreshes: 0 } : links
}
