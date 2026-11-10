// What Settings › Import has already read from PracticeHub's Classic API this
// page session, so the next step does not read it again.
//
// A migration is a dozen separate steps, and nearly every one of them starts
// by reading the whole patient list to match its records to their patient:
// Ledger, Bonos, Notes, Care plans, Logs, Sticky notes, Forms, Files, the two
// checks. Appointment types and Appointments both read every appointment;
// Ledger, Check migration and Check a patient all read every invoice and
// payment. The Classic API allows one request a second and a page holds 100
// records, so on a clinic of 1,500 patients, 8,700 appointments and 7,000
// invoices that is roughly ten minutes of a migration spent re-reading lists
// that were read a step earlier and have not changed: the steps write to
// QuiroFlow, never to PracticeHub.
//
// Held in memory for the page session only, so a reload starts clean, and
// for a bounded time, so a record corrected in PracticeHub halfway through a
// migration is not missed for the rest of the afternoon. The Connection step
// forgets everything when the connection changes; a step's connect form
// offers to read afresh.

/** How long a list is reused for after it was read. */
export const PRACTICEHUB_READ_TTL_MS = 10 * 60 * 1000

// /files carries a signed download URL per file, and those expire: the Files
// step re-lists to refresh them (see PracticeHubFilesImporter). A held copy
// would hand it the expired ones back.
const NEVER_HELD = new Set(['/files'])

interface Held {
  rows: unknown[]
  readAt: number
}

const held = new Map<string, Held>()

function keyOf(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '').toLowerCase()} ${path}`
}

/** Whether a complete read of `path` is worth keeping for the next step. */
export function isPracticeHubReadHeld(path: string): boolean {
  return !NEVER_HELD.has(path.replace(/\?.*$/, ''))
}

/** The rows read for `path` within the TTL, or null. A copy: callers may sort or splice it. */
export function recallPracticeHubRead<T>(baseUrl: string, path: string, now = Date.now()): { rows: T[]; readAt: number } | null {
  const entry = held.get(keyOf(baseUrl, path))
  if (!entry) return null
  if (now - entry.readAt > PRACTICEHUB_READ_TTL_MS) {
    held.delete(keyOf(baseUrl, path))
    return null
  }
  return { rows: [...(entry.rows as T[])], readAt: entry.readAt }
}

/** Keeps a complete read of `path`, unless its answer is one that expires. */
export function rememberPracticeHubRead<T>(baseUrl: string, path: string, rows: T[], now = Date.now()): void {
  if (!isPracticeHubReadHeld(path)) return
  held.set(keyOf(baseUrl, path), { rows: [...rows], readAt: now })
}

/** How many lists are currently held for `baseUrl`, counting only those within the TTL. */
export function practiceHubReadsHeld(baseUrl: string, now = Date.now()): number {
  let count = 0
  for (const [key, entry] of held) {
    if (key.startsWith(`${baseUrl.replace(/\/$/, '').toLowerCase()} `) && now - entry.readAt <= PRACTICEHUB_READ_TTL_MS) count++
  }
  return count
}

/** Drops every held list: the next read of anything goes to PracticeHub. */
export function forgetPracticeHubReads(): void {
  held.clear()
}
