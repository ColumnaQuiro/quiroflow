import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// The shapes every PracticeHub import step shares when it runs on the server
// (server/utils/importJobs.ts), the way utils/quirocitasImport.ts runs
// Quirocitas.
//
// A job first READS PracticeHub's Classic API into import_snapshots -- every
// list below, page by page, de-duplicated by id the way usePracticeHubApi's
// fetchAll does it -- and each step then PLANS from that copy against what is
// already in QuiroFlow, and APPLIES the plan in chunks a slice can stop
// between. A step run twice finds what it wrote the first time by its
// PracticeHub reference and writes only what is missing or changed, which is
// what lets a slice that runs out of time simply plan again next time.
//
// Everything here runs with the service role, so every QuiroFlow read is
// scoped to the account BY HAND (`.eq('account_id', ctx.accountId)`): RLS is
// not there to do it, and a read without it would plan one clinic's import
// against another clinic's rows.

export type PracticeHubStepKind = 'patients' | 'appointment_types' | 'appointments' | 'ledger' | 'bonos'

// The order a full sync runs them in, which is the order they depend on each
// other: every step finds its patient by patients.external_reference;
// appointment types re-point visits by the appointment's reference, so it
// runs after Appointments has written them; the ledger links invoices to
// visits; and settle_imported_invoices pools family bonos through
// package_purchase_shares, which Bonos writes -- so Bonos settles again after
// it has written shares (see the Bonos planner).
export const PRACTICEHUB_STEPS: PracticeHubStepKind[] = ['patients', 'appointments', 'appointment_types', 'ledger', 'bonos']

// Every list a step plans from. The read walks them in this order, all from
// the Classic API except PRACTICEHUB_V3_LISTS. /files is not here: its signed
// download links expire within the hour, so a copy of them is useless by the
// time a later slice reaches it.
export const PRACTICEHUB_LISTS = [
  '/practitioners',
  '/referral_sources',
  '/appointment_types',
  '/billable_items',
  '/payment_methods',
  '/patients',
  '/appointments',
  '/invoices',
  '/payments',
  '/patient_packages',
] as const
export type PracticeHubListPath = (typeof PRACTICEHUB_LISTS)[number]

// Read from PracticeHub 2.0's API (the phk_ key) instead: Classic has no
// /billable_items, and only 2.0's carries the amounts appointment types are
// priced from (utils/practicehubTypePrices.ts). A clinic with no 2.0 key
// saved gets no such list in its copy, and the step that wants it says so.
export const PRACTICEHUB_V3_LISTS: ReadonlySet<PracticeHubListPath> = new Set<PracticeHubListPath>(['/billable_items'])

export interface PracticeHubSnapshot {
  /** When the read that made this copy finished. */
  readAt: string
  baseUrl: string
  lists: Partial<Record<PracticeHubListPath, unknown[]>>
}

/** One list out of the copy. Throws when the read never finished it, rather than planning against an empty list -- an empty /payments would read as "no money was ever taken". */
export function practiceHubList<T>(snapshot: PracticeHubSnapshot, path: PracticeHubListPath): T[] {
  const rows = snapshot.lists[path]
  if (!rows) throw new Error(`The copy read from PracticeHub has no ${path}. Read PracticeHub again.`)
  return rows as T[]
}

// The same shape as QuirocitasPlan, so the job runner and the preview screens
// treat both sources alike.
export interface PracticeHubPlan {
  stats: { label: string; value: number | string; tone?: 'good' | 'plain' }[]
  columns: { key: string; label: string; wrap?: boolean }[]
  rows: Record<string, string>[]
  warnings: string[]
  /** Units of work Apply will do, for its progress bar. */
  total: number
  /**
   * Writes the plan. Calls `progress` with the units done so far, and checks
   * `shouldStop` between chunks: when it says stop, return what was written
   * so far -- the next slice plans again and finds only what is left.
   */
  apply(progress: (done: number) => void, shouldStop: () => boolean): Promise<{ written: number; errors: string[] }>
}

export interface PracticeHubImportContext {
  /** The service-role client. RLS does not scope anything: filter by accountId on every read. */
  supabase: SupabaseClient<Database>
  accountId: string
  /** The clinic new patients and appointments go into (the browser importer's clinic dropdown). */
  clinicId: string | null
  /** accounts.default_phone_country: the country for a number PracticeHub gives none for. */
  defaultPhoneCountry: string
  t: (en: string, es: string) => string
}

export type PracticeHubStepPlanner = (ctx: PracticeHubImportContext, snapshot: PracticeHubSnapshot) => Promise<PracticeHubPlan>
