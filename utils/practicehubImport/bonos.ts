import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { formatEur, formatEurFromAmount } from '~/utils/billing'
import { practiceHubChargedAtPurchase } from '~/utils/visitCharging'
import { practiceHubList, type PracticeHubPlan, type PracticeHubStepPlanner } from '~/utils/practicehubImport/types'

// The Bonos step of a PracticeHub import: PracticeHub's patient packages
// against the package_purchases already here.
//
// The planning half -- planPracticeHubBonos() and the helpers above it -- is
// pure and is the ONE copy of the rules: components/import/
// PracticeHubPatientPackagesImporter.vue reads its rows in the browser and
// calls it, and planBonos below reads the same rows with the service role and
// calls it on the server. A rule changed here changes both.
//
// Nothing here writes credit or invoices for a bono (see the comments in
// apply). sessions_used only ever rises, a reference is only stamped where
// there is none, and the only rows ever deleted are the provably-empty
// duplicates the merge plan names.

// first_name/last_name are optional because nothing else here needs them and
// PracticeHub's docs do not promise them -- they are used only to put a name
// next to an unmatched patient number, and the number alone still works.
export interface PHPatient { id: number; patient_number: string; email?: string | null; first_name?: string | null; last_name?: string | null }
export interface PHPatientPackage {
  id: number
  // PracticeHub's docs example shows a top-level patient_id, but real
  // patient_packages records leave it null and only populate
  // subscribed_patients -- checking both is what actually finds a match.
  patient_id: number | null
  subscribed_patients: { patient_id: number }[] | null
  name: string | null
  package_type: string | null
  active: number | null
  visits: number | null
  visits_left: number | null
  // How many of `visits` PracticeHub lets through at 0. Zero on a clinic that
  // charges every visit; visits - 1 on one that invoices the whole price on
  // the visit the bono is bought at. See practiceHubChargedAtPurchase.
  free_visits?: number | null
  price: number | null
  balance: number | null
  owing: number | null
  package_balance: number | null
  created: string
}

export function patientIdOf(pkg: PHPatientPackage): number | null {
  return pkg.patient_id ?? pkg.subscribed_patients?.[0]?.patient_id ?? null
}

// A PracticeHub bono can be subscribed to several patients -- a family bono
// the household shares. Only the first was ever read, so the bono landed
// against one member and the rest had no way to draw a session from it.
// Everyone after the owner becomes a package_purchase_shares row.
export function sharedPatientIdsOf(pkg: PHPatientPackage, ownerPhId: number | null): number[] {
  const ids = (pkg.subscribed_patients ?? []).map((sp) => sp.patient_id)
  return [...new Set(ids)].filter((id) => id !== ownerPhId)
}

export interface BonoCandidate {
  phPackageId: number
  patientId: string
  patientName: string
  packageName: string
  visits: number | null
  visitsLeft: number | null
  price: number | null
  balance: number | null
  owing: number | null
  packageBalance: number | null
  created: string
  sessionsTotal: number
  sessionsUsed: number
  priceCents: number
  isActive: boolean
  // What the patient still owes on this bono, from PracticeHub's own
  // `package_balance`. Raised as an unpaid invoice so the debt shows in
  // reports instead of being implied by a PracticeHub column nobody reads.
  owedCents: number
  // True for a package already in package_purchases: applying it adds only
  // the missing invoice, reference, shares and counter sync, leaving the rest
  // of the purchase alone.
  repairOnly: boolean
  // What PracticeHub now says this bono is, where that differs from the row
  // here. Null when they already agree. See syncFor().
  counterSync: { sessionsTotal?: number; sessionsUsed?: number; priceCents?: number } | null
  // PracticeHub reports FEWER sessions used than are recorded here. Never
  // applied automatically -- see syncFor() -- but surfaced so it can be seen.
  usedAheadOfPracticeHub: boolean
  // Set for an already-imported package so its purchase row can be pointed
  // at the invoice this creates.
  existingPurchaseId: string | null
  // True for a bono matched by patient and day that carries no PracticeHub
  // reference yet -- applying it writes the reference so the match stops
  // depending on the date.
  needsReferenceStamp: boolean
  // PracticeHub's `active` flag disagrees with what is stored, which is what
  // a bono closed (or re-opened) since it was imported looks like. Applying it
  // writes is_closed, and a closed bono then stops offering its sessions and
  // stops counting as money the patient can draw on.
  needsClosedStamp: boolean
  // PracticeHub has already invoiced everything this bono costs, so a session
  // logged here charges nothing (package_purchases.charged_at_purchase). Set
  // on insert; needsChargeStamp when a bono already here says otherwise.
  chargedAtPurchase: boolean
  needsChargeStamp: boolean
  // The other patients PracticeHub has subscribed to this bono -- a family
  // bono the whole household draws sessions from. Owner excluded.
  sharedWith: { id: string; name: string }[]
}

// A bono row as it exists here, carried through matching so a PracticeHub
// bono can claim the row that actually corresponds to it rather than
// whichever one happens to be first.
export interface LocalBono {
  id: string
  patientId: string
  packageName: string
  priceCents: number
  sessionsUsed: number
  sessionsTotal: number
  purchasedAt: string
  reference: string | null
  visitRows: number
  hasInvoice: boolean
  // What is stored as outstanding, so a re-run can tell whether PracticeHub
  // has moved since. Null on a bono imported before 0174 -- which is all of
  // them on this account, and why the first re-run backfills every one.
  owedCents: number | null
  // Whether the row here already says PracticeHub has closed this bono, so a
  // re-run can tell that PracticeHub has since closed one that was live when
  // it was imported.
  isClosed: boolean
  chargedAtPurchase: boolean
}

export interface UnmatchedPracticeHubPatient { number: string; name: string; bonos: string[] }
export interface PhDuplicateBono { patientName: string; packageName: string; priceCents: number; phPackageId: number; owedCents: number }
export interface VoidBono { patientName: string; packageName: string; priceCents: number; phPackageId: number }
export interface MispricedBono { patientName: string; packageName: string; phPackageId: number; priceCents: number; visits: number; visitsLeft: number; statedBalance: number; impliedBalance: number }
export interface DuplicateBonoMerge {
  patientName: string
  packageName: string
  priceCents: number
  survivorId: string
  survivorVisits: number
  discardId: string
  // Moved onto the survivor when the row being removed is the one carrying
  // the PracticeHub reference, so its credit history stays attached.
  referenceToMove: string | null
}

// Credit on account is money the patient has already handed over and not yet
// consumed -- not the value of the sessions they are entitled to. A bono can
// be sold half-paid: the patient may take all 12 sessions, but the unpaid
// half is a receivable that shows on their invoice, never as credit they
// hold. So:
//
//     credit = what they paid  -  what they have consumed
//
// PracticeHub gives both halves of that directly:
//   `balance`          = visits_left x (price / visits), i.e. price MINUS
//                        consumed. Verified against all 545 records in the
//                        live account: it matches for 519, the rest differing
//                        only by rounding or by the package being over-used.
//   `package_balance`  = paid MINUS price, so it is 0 on a fully-paid bono
//                        and NEGATIVE by exactly what is still owed.
//   `owing`            = always blank on this account; unusable.
//
// Adding them telescopes the price away and leaves paid minus consumed:
//
//     balance + package_balance = (price - consumed) + (paid - price)
//                               = paid - consumed
//
// Checked against real payment history for four patients: 440 + (-240) = 200
// paid of a 480 bono with 1 of 12 taken; 516 + (-301) = 215;
// 484 + (-264) = 220; and one fully paid, 360 + 0 = 360.
//
// Using `balance` alone -- as this did -- credits the whole entitlement and
// hands part-payers money they never paid: 440 instead of 200 for the first.
// Using `package_balance` alone is worse still, since it is negative wherever
// anything is owed.
//
// Clamped at zero: 8 packages are over-used and carry a negative balance, and
// a patient cannot hold negative prepaid credit -- extra visits owed are an
// invoice, not a credit.
//
// Caveat worth knowing before a big run: `package_balance` is only as good as
// PracticeHub's own payment linking. Where their staff took a payment without
// linking it to the bono (one patient: PH reports 602 outstanding, they
// actually paid 301) PH under-reports what was paid, so this under-reads.
// It never over-reads, which is the safer direction, and the reconciliation
// report is where those show up.
//
// This no longer drives any write. A bono's remaining value lives on the
// sessions counter alone (0161), so the only thing left to ask of this figure
// is whether a cancelled bono was ever paid for -- see neverUsedAndEmpty.
export function paidNotConsumedCentsFor(pkg: PHPatientPackage): number {
  const paidMinusConsumed = (pkg.balance ?? 0) + (pkg.package_balance ?? 0)
  return Math.max(0, Math.round(paidMinusConsumed * 100))
}

// Does PracticeHub's own arithmetic on this bono add up?
//
// `balance` is documented above as visits_left x (price / visits) -- verified
// against 519 of 545 live records. When it does NOT, one of those three
// numbers is wrong in PracticeHub, and `price` is taken here as given, so a
// wrong price is copied in and then silently mis-charges every session drawn
// from that bono for the rest of its life.
//
// That is not hypothetical. One patient's Bono mantenimiento (PH 524)
// came over at 240 EUR for 12 sessions where the product is 480 for 12 --
// someone appears to have entered the half they were paying as the price.
// Their visit on 2026-09-15 drew 20 EUR instead of 40, five weeks after the import,
// and nothing would have surfaced it. PracticeHub's own numbers disagreed the
// whole time: 10 visits left at 20 each is 200, and it stated a balance of
// 160.
//
// Deliberately NOT a comparison against our own package templates, which was
// the obvious version of this check. Two members of one family hold a Bono 14
// at 301 EUR against a 602 template -- half rate, and entirely real: each paid
// their 301 in two instalments. A template check calls that an error every
// run. This one does not flag them, because their figures are self-consistent
// (1 visit left x 21.50 = the 21.50 balance PracticeHub states).
//
// Reported, never corrected. Which of the three numbers is wrong is not
// knowable from here -- PH 524's balance does not match ANY of the candidate
// prices -- so this asks a human to look at the bono in PracticeHub before the
// price is trusted.
//
// Tuned against all 553 snapshot records, because a plain "these disagree"
// check flags 27 of them and most are noise in two recognisable shapes:
//
//   * 9 ACTIVE bonos whose balance is higher than sessions left imply by
//     EXACTLY one session (46 on a Bono 10, 44 on a Bono 12, 43 on a Bono 14).
//     PracticeHub looks to count the balance before decrementing the visit.
//     Their prices are all correct, so an over-statement is not the signal.
//   * 14 CLOSED bonos with no sessions left and a few euros of round-off.
//
// What is left once those go is a SHORTFALL on a live bono -- the stated
// balance being less than the remaining sessions are worth -- which is the
// shape PH 524 has (160 against 200). Directional, and 10 EUR rather than
// 1, because two records sit 4 EUR under on identical Bono 10s and look like
// the same rounding as the closed ones. That leaves 2 of 553 flagged: PH 524,
// the known bad one, and PH 241, half a session under on a half-paid bono and
// worth the same human glance. Widen the tolerance if real ones start slipping
// through; the cost of being wrong here is a line in a report, not a write.
export const BALANCE_SHORTFALL_TOLERANCE_EUR = 10
export function balanceDisagreesWithPrice(pkg: PHPatientPackage): { statedBalance: number; impliedBalance: number } | null {
  const visits = pkg.visits ?? 0
  const visitsLeft = pkg.visits_left ?? 0
  const price = pkg.price ?? 0
  // Live bonos only: a closed one's price can no longer mis-charge anything,
  // since no further session will ever be drawn from it.
  if (pkg.active !== 1) return null
  // An over-used bono carries a negative balance by design (see
  // paidNotConsumedCentsFor), a spent one has nothing left to mis-charge, and
  // a priceless one has nothing to check.
  if (visits <= 0 || price <= 0 || visitsLeft <= 0 || visitsLeft > visits) return null
  const impliedBalance = visitsLeft * (price / visits)
  const statedBalance = pkg.balance ?? 0
  if (statedBalance >= impliedBalance - BALANCE_SHORTFALL_TOLERANCE_EUR) return null
  return { statedBalance, impliedBalance }
}

// What is still owed on a bono. `package_balance` is paid minus price, so it
// is negative by exactly the outstanding amount and zero once settled.
//
// This is raised as an invoice for the OUTSTANDING amount only, not for the
// bono's full price. The paid half is already in QuiroFlow as its own
// invoice and payment, brought over by the payments importer -- billing the
// full price again and re-recording the payment would double the clinic's
// takings. What migration is actually missing is the receivable, so that is
// what gets created: an unpaid invoice, no payment rows, money-in untouched.
//
// Only ever raised for an ACTIVE bono. A bono PracticeHub deactivated years
// ago that still reads as unpaid is far more likely to be their staff never
// having linked the payment (see the caveat on paidNotConsumedCentsFor) than a debt
// this clinic is still owed, and inventing receivables against old patients
// is the one mistake here that reaches the outside world.
// What PracticeHub says is still owed on this bono. Stored on the purchase
// since 0174 and shown on the card -- it used to be turned into an invoice,
// which was a charge PracticeHub does not have and distorted the balance.
export function owedCentsFor(pkg: PHPatientPackage): number {
  return Math.max(0, Math.round(-(pkg.package_balance ?? 0) * 100))
}

// What to change on a bono already here so it reads what PracticeHub reads.
//
// A bono is imported once and then never looked at again, so whatever
// PracticeHub said that day is frozen here forever. That is fine until the
// clinic corrects PracticeHub -- which is exactly what onboarding is: the
// source data gets cleaned while the migration is already running. One
// patient's bono came over as 11 sessions at 440 EUR because that is what
// PracticeHub said at the time; it now says 12 at 480 with 2 consumed, and
// nothing here could ever pick that up.
//
// sessions_total and price_cents are properties of the purchase: PracticeHub
// owns them and they are taken as given.
//
// sessions_used only ever RISES. PracticeHub knowing about consumption we do
// not is the normal case and must be applied. The reverse -- fewer used there
// than here -- means sessions were drawn in QuiroFlow since the import, and
// lowering the count would hand those back as free visits. That direction is
// reported (usedAheadOfPracticeHub) rather than written, because giving a
// patient sessions they already had is the one error here nobody notices.
export function syncFor(local: LocalBono, phSessionsTotal: number, phSessionsUsed: number, phPriceCents: number) {
  const sync: { sessionsTotal?: number; sessionsUsed?: number; priceCents?: number } = {}
  if (phSessionsTotal > 0 && local.sessionsTotal !== phSessionsTotal) sync.sessionsTotal = phSessionsTotal
  if (phPriceCents > 0 && local.priceCents !== phPriceCents) sync.priceCents = phPriceCents
  if (phSessionsUsed > local.sessionsUsed) sync.sessionsUsed = phSessionsUsed
  return {
    counterSync: Object.keys(sync).length > 0 ? sync : null,
    usedAheadOfPracticeHub: phSessionsUsed < local.sessionsUsed,
  }
}

// Which bonos have credit rows pointing at them. Nothing here writes credit
// any more, but the duplicate merge DELETES a redundant bono row, and
// deleting one the ledger still references would strand that credit. 0161
// offsets the retired bono credit rather than deleting it, so those rows
// are still there to be stranded and this guard still has work to do.
//
// Anchored on the exact forms this importer used to write -- PH-package-12,
// PH-package-12-adjustment, PH-package-12-adjustment-2 -- and nothing else.
// A looser "starts with PH-package-12" once swallowed a hand-written repair
// (PH-package-479-duplicate-record-adjustment, correcting a duplicate on a
// different patient record entirely) into bono 479's total.
export const PACKAGE_CREDIT_REF = /^(PH-package-\d+)(?:-adjustment(?:-\d+)?)?$/

/** Everything the plan reads, already read: PracticeHub's two lists and this account's rows. */
export interface PracticeHubBonosInput {
  phPatients: PHPatient[]
  phPackages: PHPatientPackage[]
  ourPatients: { id: string; external_reference: string | null; email: string | null; first_name: string; last_name: string | null }[]
  purchases: {
    id: string
    patient_id: string
    purchased_at: string
    external_reference: string | null
    invoice_id: string | null
    package_name: string | null
    price_cents: number | null
    sessions_used: number | null
    sessions_total: number | null
    owed_cents: number | null
    is_closed: boolean | null
    charged_at_purchase: boolean | null
  }[]
  /** package_sessions.package_purchase_id, one per session row. */
  sessionPurchaseIds: (string | null)[]
  shares: { package_purchase_id: string; patient_id: string }[]
  /** payment_schedules.package_purchase_id. */
  scheduledPurchaseIds: (string | null)[]
  /** account_credits rows carrying an external_reference. */
  credits: { amount_cents: number; external_reference: string | null }[]
}

export interface PracticeHubBonosPlan {
  candidates: BonoCandidate[]
  // Who was skipped, not just how many. This used to be a bare counter, and it
  // counted per bono rather than per person: someone on three bonos was three
  // "unmatched patients". Worse, the count named nobody, so a real gap -- a
  // patient PracticeHub knows and we do not, whose bonos and shares are silently
  // dropped by every importer -- was a number on a screen with no way to act on
  // it. Keyed by PracticeHub patient id, so each person appears once, with the
  // bonos they were skipped on.
  unmatchedPatients: Map<string, UnmatchedPracticeHubPatient>
  skippedNoValue: number
  // Bonos that exist here but that no PracticeHub bono claimed. Before this
  // existed the importer could hand one local row to the first bono of a
  // same-day pair and insert a fresh row for the second, leaving a duplicate
  // nothing ever mentioned -- six patients ended up with two rows for one
  // bono, and only a hand-written SQL query found them. Anything left over
  // after matching is now reported instead of ignored.
  unmatchedLocalBonos: { patientName: string; bono: LocalBono }[]
  // Bonos PracticeHub itself holds twice. Nine patients here already carry the
  // result: two rows of the same name, price and day, the earlier id completely
  // untouched and the later one holding all the usage. That is PracticeHub's
  // shape, not ours -- consecutive ids, the first never used. Importing the
  // empty one gives the patient a whole extra bono of sessions they never
  // bought, and where PracticeHub also reports it as unpaid it would raise an
  // invoice for money nobody owes.
  phDuplicateBonos: PhDuplicateBono[]
  // Bonos PracticeHub still lists but on which nothing ever happened: no
  // session used, no balance, nothing owed, nobody sharing them.
  voidBonos: VoidBono[]
  // Bonos whose PracticeHub figures contradict each other -- see
  // balanceDisagreesWithPrice. Imported as-is and listed for a human to check,
  // because a wrong price here mis-charges every session drawn from the bono.
  mispricedBonos: MispricedBono[]
  // Bono rows here that stand for the same PracticeHub bono as another row.
  // Decided by counting: when this patient has more rows of a given bono on a
  // given day than PracticeHub has bonos, the surplus is ours, not theirs.
  duplicateMerges: DuplicateBonoMerge[]
}

/**
 * What the Bonos step would write, from rows already read. Pure: the browser
 * importer and the server planner both call it with their own reads.
 */
export function planPracticeHubBonos(input: PracticeHubBonosInput): PracticeHubBonosPlan {
  const { phPatients, phPackages } = input
  const unmatchedPatients = new Map<string, UnmatchedPracticeHubPatient>()
  const phDuplicateBonos: PhDuplicateBono[] = []
  const voidBonos: VoidBono[] = []
  const mispricedBonos: MispricedBono[] = []
  let skippedNoValue = 0

  const patientNumberById = new Map(phPatients.map((p) => [String(p.id), p.patient_number]))
  const phPatientById = new Map(phPatients.map((p) => [String(p.id), p]))
  // How many PracticeHub patients share each address, so the fallback below
  // only ever fires on an address that identifies exactly one person there.
  const phEmailCount = new Map<string, number>()
  for (const p of phPatients) {
    const email = p.email?.trim().toLowerCase()
    if (email) phEmailCount.set(email, (phEmailCount.get(email) ?? 0) + 1)
  }
  const patientNameById = new Map(
    phPatients.map((p) => [String(p.id), [p.first_name, p.last_name].filter(Boolean).join(' ').trim()]),
  )

  // Records a PracticeHub patient we hold no match for, against the bono it
  // was skipped on. Same person on several bonos is one entry.
  const noteUnmatched = (phId: number | null, bonoName: string) => {
    const key = phId === null ? 'unknown' : String(phId)
    const entry = unmatchedPatients.get(key) ?? {
      number: (phId !== null ? patientNumberById.get(String(phId)) : null) ?? '(no patient number)',
      name: (phId !== null ? patientNameById.get(String(phId)) : '') || '',
      bonos: [],
    }
    if (!entry.bonos.includes(bonoName)) entry.bonos.push(bonoName)
    unmatchedPatients.set(key, entry)
  }

  const ourPatientByRef = new Map<string, { id: string; name: string }>()
  // Also by id, so a bono left over after matching can be named. Every
  // patient goes in here, reference or not -- an unreferenced one is
  // exactly the case where naming them matters.
  const ourPatientNameById = new Map<string, string>()
  // Patients whose external_reference is not their PracticeHub number are
  // matched on email instead. 49 records here hold something else in that
  // field -- a DNI, an address, an old code -- left by the original CSV
  // import, and the Patients import cannot repair them because it only
  // fills a reference that is blank. Without this their bonos are dropped
  // by every run, which is what the "no matching record here" list was.
  const ourEmailCount = new Map<string, number>()
  const ourPatientByEmail = new Map<string, { id: string; name: string }>()
  for (const p of input.ourPatients) {
    const name = `${p.first_name} ${p.last_name ?? ''}`.trim()
    ourPatientNameById.set(p.id, name)
    if (p.external_reference) ourPatientByRef.set(p.external_reference, { id: p.id, name })
    const email = p.email?.trim().toLowerCase()
    if (email) {
      ourEmailCount.set(email, (ourEmailCount.get(email) ?? 0) + 1)
      ourPatientByEmail.set(email, { id: p.id, name })
    }
  }

  // The PracticeHub number first, since that is exact. Email only as a
  // fallback, and only when it belongs to exactly one patient on BOTH
  // sides: 57 records here share an address with another patient, usually
  // a family on one inbox, and crediting a bono to the wrong member of a
  // household is worse than not importing it.
  function ourPatientForPh(phId: number | null): { id: string; name: string } | undefined {
    if (phId === null) return undefined
    const ph = phPatientById.get(String(phId))
    if (!ph) return undefined
    const byRef = ph.patient_number ? ourPatientByRef.get(ph.patient_number) : undefined
    if (byRef) return byRef
    const email = ph.email?.trim().toLowerCase()
    if (!email || phEmailCount.get(email) !== 1 || ourEmailCount.get(email) !== 1) return undefined
    return ourPatientByEmail.get(email)
  }

  // Our own bono rows, indexed two ways. `external_reference` is the exact
  // key for anything this importer created, but the 178 bonos backfilled by
  // hand before it existed have none -- for those, same patient plus same
  // purchase day is the key, and it resolves all 178 of them with nothing
  // left over.
  const purchaseByRef = new Map<string, string>()
  const localBonoById = new Map<string, LocalBono>()
  // A LIST per day, not a single id. Two PracticeHub bonos created on the
  // same day for the same patient used to both resolve to the same local
  // row, and each then took back the same deposit: one patient's two bonos
  // both claimed their one 360 EUR row and clawed it back twice, leaving
  // them at -280 EUR. Each local row is now claimed by at most one bono, and a
  // bono that finds nothing left to claim is a genuinely new one to insert.
  const purchasesByPatientDay = new Map<string, LocalBono[]>()
  // Rows carrying no PracticeHub reference: the bonos the hand backfill
  // created. The importer recognises them by patient and day, but never
  // wrote the reference onto them, so nothing downstream can see they are
  // the same bono -- the migration check counts by reference and reported
  // 188 of them as missing from a set that is entirely present.
  const purchaseNeedsReference = new Set<string>()
  for (const row of input.purchases) {
    if (row.external_reference) purchaseByRef.set(row.external_reference, row.id)
    const dayKey = `${row.patient_id}|${String(row.purchased_at).slice(0, 10)}`
    const local: LocalBono = {
      id: row.id,
      patientId: row.patient_id,
      packageName: row.package_name ?? '',
      priceCents: row.price_cents ?? 0,
      sessionsUsed: row.sessions_used ?? 0,
      sessionsTotal: row.sessions_total ?? 0,
      owedCents: row.owed_cents,
      isClosed: row.is_closed ?? false,
      chargedAtPurchase: row.charged_at_purchase ?? false,
      purchasedAt: String(row.purchased_at),
      reference: row.external_reference ?? null,
      visitRows: 0,
      hasInvoice: !!row.invoice_id,
    }
    localBonoById.set(row.id, local)
    const sameDay = purchasesByPatientDay.get(dayKey)
    if (sameDay) sameDay.push(local)
    else purchasesByPatientDay.set(dayKey, [local])
    if (!row.external_reference) purchaseNeedsReference.add(row.id)
  }

  // Visits recorded against each bono. A leftover row carrying visits is
  // the one the clinic has actually been drawing sessions from, which is
  // what makes it safe to say which of a duplicated pair is the live one.
  for (const purchaseId of input.sessionPurchaseIds) {
    const local = purchaseId ? localBonoById.get(purchaseId) : undefined
    if (local) local.visitRows++
  }

  // Bonos that already have their household members attached, so a re-run
  // does not add the same person to the same bono twice.
  const purchaseHasShares = new Set<string>()
  // Same rows, keyed by bono alone -- used to refuse to remove a bono that
  // a household is attached to.
  const sharedPurchaseIds = new Set<string>()
  // Per member, not per bono. Testing only "does this bono have any
  // shares" meant a bono someone was added to already could never gain
  // the rest of the household: the first member made it look done.
  for (const row of input.shares) {
    purchaseHasShares.add(`${row.package_purchase_id}|${row.patient_id}`)
    sharedPurchaseIds.add(row.package_purchase_id)
  }

  // Instalment plans. payment_schedules cascades on delete, so a bono
  // carrying one is never a candidate for removal however empty it looks.
  const scheduledPurchaseIds = new Set<string>()
  for (const id of input.scheduledPurchaseIds) if (id) scheduledPurchaseIds.add(id)

  const creditCentsByPackageRef = new Map<string, number>()
  for (const row of input.credits) {
    const base = row.external_reference ? PACKAGE_CREDIT_REF.exec(row.external_reference)?.[1] : undefined
    if (base) creditCentsByPackageRef.set(base, (creditCentsByPackageRef.get(base) ?? 0) + row.amount_cents)
  }

  const built: BonoCandidate[] = []
  // Which local rows a PracticeHub bono has taken, so what is left over at
  // the end can be reported rather than quietly duplicated.
  const claimedPurchaseIds = new Set<string>()

  // Pick the local row that actually stands for this PracticeHub bono,
  // rather than whichever one came first. The old code took the head of
  // the day's list with `.shift()`, so when PracticeHub held two bonos for
  // one patient on one day the first bono took the only local row and the
  // second inserted a brand new one -- a duplicate that showed as extra
  // sessions on the patient and split their credit across two rows. Six
  // patients here are in exactly that state.
  //
  // A row that already carries a PracticeHub reference is never claimed
  // this way: it belongs to a specific bono, and if that bono is not in
  // this run (deleted in PracticeHub, say) letting a different one take it
  // would rewrite the wrong record. Among the unreferenced rows the best
  // match wins -- same price and same sessions used first, then price
  // alone -- and ties fall back to the earliest, so a re-run is stable.
  function claimPurchaseForDay(dayKey: string, priceCents: number, sessionsUsed: number): string | null {
    const sameDay = purchasesByPatientDay.get(dayKey)
    if (!sameDay) return null
    let best: LocalBono | null = null
    let bestScore = -1
    for (const local of sameDay) {
      if (local.reference !== null || claimedPurchaseIds.has(local.id)) continue
      const score = (local.priceCents === priceCents ? 2 : 0) + (local.sessionsUsed === sessionsUsed ? 1 : 0)
      if (score > bestScore) {
        best = local
        bestScore = score
      }
    }
    if (!best) return null
    claimedPurchaseIds.add(best.id)
    return best.id
  }

  // Deterministic order: whichever bono PracticeHub created first claims
  // the local row that stands for it, so a re-run reaches the same answer.
  const sortedPackages = [...phPackages].sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id - b.id))

  // Credit is reconciled per patient-day, not per bono.
  //
  // Several PracticeHub bonos can share one day, and the rows that pay for
  // them do not divide cleanly between them: the hand backfill left ONE
  // deposit for the day whichever way PracticeHub split it, and a correction
  // written earlier was recorded against whichever bono happened to claim
  // that deposit on that run. Reading each bono on its own then strands
  // those rows -- one patient has one deposit of 322 EUR, a -322
  // correction against bono 471 and a +92 row against bono 473, all correct
  // together; read separately, 471 shows a bare -322 with nothing behind it
  // and the tool offers to hand it back.
  //
  // Summed over the day the arithmetic closes and stays closed no matter
  // which bono is read first:
  //
  //   deposit +322, correction -322, bono 473 +92  ->  carries  92
  //   targets: bono 473 -> 92, bono 471 -> 0       ->  target   92
  //                                                   delta      0
  //
  // The whole day's correction is written against the first bono of the day;
  // the rest need no credit row of their own. For the single-bono days that
  // are almost all of them, a group of one behaves exactly as before.
  // Pass A -- survey PracticeHub's own shape of the data, so the passes that
  // follow can all agree on which bonos are real. A shape is one patient,
  // one day, one package name, one price.
  const phShapeHasUsedBono = new Set<string>()
  const phShapeTotalCount = new Map<string, number>()
  const phShapeUsedCount = new Map<string, number>()
  const shapeKeyOf = (patientId: string, pkg: PHPatientPackage) =>
    `${patientId}|${pkg.created.slice(0, 10)}|${Math.round((pkg.price ?? 0) * 100)}|${pkg.name || pkg.package_type || 'Package'}`
  const sessionsUsedOf = (pkg: PHPatientPackage) => {
    const total = pkg.visits ?? pkg.visits_left ?? 0
    return Math.max(0, total - (pkg.visits_left ?? total))
  }
  for (const pkg of sortedPackages) {
    const phId = patientIdOf(pkg)
    const patient = ourPatientForPh(phId)
    if (!patient) continue
    const shapeKey = shapeKeyOf(patient.id, pkg)
    phShapeTotalCount.set(shapeKey, (phShapeTotalCount.get(shapeKey) ?? 0) + 1)
    if (sessionsUsedOf(pkg) > 0) {
      phShapeHasUsedBono.add(shapeKey)
      phShapeUsedCount.set(shapeKey, (phShapeUsedCount.get(shapeKey) ?? 0) + 1)
    }
  }
  // An untouched bono sitting beside a used one of the same shape is
  // PracticeHub's duplicate, and is left out of everything below -- the
  // credit target, the day's lead, the import itself -- so every pass counts
  // the same bonos.
  const isPhDuplicate = (patientId: string, pkg: PHPatientPackage) =>
    sessionsUsedOf(pkg) === 0 && phShapeHasUsedBono.has(shapeKeyOf(patientId, pkg))
  // How many bonos of a shape actually get imported, which is the yardstick
  // for deciding whether a row here is a surplus copy of another row here.
  const phBonoCountByShape = new Map<string, number>()
  for (const [shapeKey, total] of phShapeTotalCount) {
    phBonoCountByShape.set(shapeKey, phShapeHasUsedBono.has(shapeKey) ? phShapeUsedCount.get(shapeKey) ?? 0 : total)
  }

  for (const pkg of sortedPackages) {
    const externalRef = `PH-package-${pkg.id}`

    // Closed packages are imported too, as history. Skipping them is what
    // left a patient's Billing tab showing a course of visits with nothing
    // that paid for them: a spent bono is deactivated in PracticeHub, so
    // every fully-used course was being dropped. They come in with no
    // credit attached (see below), so they add the record without moving
    // anyone's balance.
    const isActive = pkg.active === 1

    const phPatientId = patientIdOf(pkg)
    const ourPatient = ourPatientForPh(phPatientId)
    if (!ourPatient) {
      noteUnmatched(phPatientId, pkg.name || pkg.package_type || 'Package')
      continue
    }

    // Resolve the household members sharing this bono to our own patients.
    // Anyone PracticeHub knows and we do not is counted as unmatched rather
    // than silently dropped.
    const sharedWith: { id: string; name: string }[] = []
    for (const sharedPhId of sharedPatientIdsOf(pkg, phPatientId)) {
      const sharedPatient = ourPatientForPh(sharedPhId)
      if (sharedPatient) sharedWith.push(sharedPatient)
      else noteUnmatched(sharedPhId, pkg.name || pkg.package_type || 'Package')
    }

    // Resolve this PracticeHub bono to our own row: by reference where the
    // importer created it, otherwise by claiming an unclaimed row from the
    // same patient and day, which is what finds the hand-backfilled ones.
    //
    // Claiming removes the row from the pool. Two bonos created on the same
    // day are two bonos: the first takes the local row that stands for it,
    // and the second finds none left and is inserted as the new record it
    // is, with its own credit. Sharing one row between them is what caused
    // the same deposit to be taken back twice.
    const dayKey = `${ourPatient.id}|${pkg.created.slice(0, 10)}`

    // PracticeHub's own duplicate: this bono has never been touched and
    // PracticeHub holds another of the same name, price and day that has
    // been. Importing it would hand the patient a second bono's worth of
    // sessions and, where PracticeHub reports it unpaid, invoice them for a
    // bono that was never sold. It is listed rather than imported, and
    // nothing is written for it -- so if one of these turns out to be a
    // real second purchase, it can still be brought in later.
    const priceCents = Math.round((pkg.price ?? 0) * 100)
    const packageName = pkg.name || pkg.package_type || 'Package'
    const sessionsUsedOfPkg = sessionsUsedOf(pkg)
    if (isPhDuplicate(ourPatient.id, pkg)) {
      phDuplicateBonos.push({
        patientName: ourPatient.name,
        packageName,
        priceCents,
        phPackageId: pkg.id,
        owedCents: isActive ? owedCentsFor(pkg) : 0,
      })
      continue
    }

    // A cancelled record: PracticeHub deactivated it and not one session was
    // ever drawn on it. One patient has two Bono 12s dated 22 July ten
    // minutes apart -- 12/12 remaining, price 528, balance 528,
    // package_balance -528, deactivated -- while PracticeHub's own billing
    // screen for them shows a single 70 EUR first visit and no bonos at all.
    // Importing them hands a patient 24 sessions they never bought.
    //
    // The discriminator is deactivated AND untouched. A bono that was
    // genuinely spent is deactivated too, but has sessions used against it.
    // One bought and not yet started is still active. And a cancelled bono
    // the patient had already PAID for is money they are owed
    // (balance + package_balance > 0), so requiring zero there keeps it
    // visible instead of quietly dropping it -- that patient's two net to
    // zero, 528 + -528, because nothing was ever paid on them. That case
    // wants a refund or a goodwill balance decided by a human, which is why
    // it is surfaced rather than resolved here.
    const neverUsedAndEmpty =
      !isActive &&
      sessionsUsedOfPkg === 0 &&
      paidNotConsumedCentsFor(pkg) === 0 &&
      sharedPatientIdsOf(pkg, phPatientId).length === 0
    if (neverUsedAndEmpty) {
      voidBonos.push({ patientName: ourPatient.name, packageName, priceCents, phPackageId: pkg.id })
      continue
    }

    // Checked after the void/duplicate branches so a bono that is being
    // skipped anyway does not also demand a human look at its price.
    const priceDisagreement = balanceDisagreesWithPrice(pkg)
    if (priceDisagreement) {
      mispricedBonos.push({
        patientName: ourPatient.name,
        packageName,
        phPackageId: pkg.id,
        priceCents,
        visits: pkg.visits ?? 0,
        visitsLeft: pkg.visits_left ?? 0,
        statedBalance: priceDisagreement.statedBalance,
        impliedBalance: priceDisagreement.impliedBalance,
      })
    }

    // Only meaningful for a live package -- a closed one having no value
    // left is the normal case, not a reason to skip it. Owing money counts
    // as something left to do even with no visits left: a bono used to the
    // last session that was never paid off is exactly the debt this is meant
    // to surface, and dropping it here would silently forgive it.
    if (isActive) {
      // Household members count as something left to record even on a bono
      // with no visits and nothing owed: the share is how the rest of the
      // family reaches it, and skipping the bono skips them with it.
      const hasRemainingValue =
        (pkg.visits_left ?? 0) > 0 || (pkg.balance ?? 0) > 0 || owedCentsFor(pkg) > 0 || sharedPatientIdsOf(pkg, phPatientId).length > 0
      if (!hasRemainingValue) {
        skippedNoValue++
        continue
      }
    }

    const visitsTotal = pkg.visits ?? pkg.visits_left ?? 0
    const visitsLeft = pkg.visits_left ?? visitsTotal
    const sessionsUsed = Math.max(0, visitsTotal - visitsLeft)

    let existingPurchaseId = purchaseByRef.get(externalRef) ?? null
    if (existingPurchaseId === null) existingPurchaseId = claimPurchaseForDay(dayKey, priceCents, sessionsUsed)
    const owedCents = isActive ? owedCentsFor(pkg) : 0

    // Only the members not already attached. A bono whose whole household
    // is recorded needs nothing; one missing a member needs just that member.
    const missingShares =
      existingPurchaseId === null ? sharedWith : sharedWith.filter((m) => !purchaseHasShares.has(`${existingPurchaseId}|${m.id}`))
    const needsShares = missingShares.length > 0
    const needsReferenceStamp = existingPurchaseId !== null && purchaseNeedsReference.has(existingPurchaseId)

    // What PracticeHub says this bono is now, against what we stored the day
    // it was imported.
    const existingLocal = existingPurchaseId !== null ? localBonoById.get(existingPurchaseId) : undefined
    const { counterSync, usedAheadOfPracticeHub } = existingLocal
      ? syncFor(existingLocal, Math.max(visitsTotal, 1), sessionsUsed, priceCents)
      : { counterSync: null, usedAheadOfPracticeHub: false }
    // What PracticeHub says is outstanding, against what is stored. On this
    // account that is the whole backfill: 520 bonos were imported before
    // there was a column to put it in.
    const storedOwed = existingLocal?.owedCents ?? null
    const needsOwedStamp = existingPurchaseId !== null && storedOwed !== owedCents
    // Deactivating a bono is a thing PracticeHub does after the fact -- it
    // is how a spent bono is retired and how a mis-sold one is cancelled --
    // so this is checked on every re-run rather than only at insert.
    const needsClosedStamp = existingPurchaseId !== null && (existingLocal?.isClosed ?? false) !== !isActive
    // Whether its price is already invoiced. Checked on every re-run too:
    // one clinic's 270 bonos were imported before there was a column for it,
    // and without it the first session logged here charged a bono PracticeHub
    // had already billed in full.
    const chargedAtPurchase = practiceHubChargedAtPurchase(pkg)
    const needsChargeStamp = existingPurchaseId !== null && (existingLocal?.chargedAtPurchase ?? false) !== chargedAtPurchase

    // Nothing left to do: the bono is here, its household is attached, its
    // counters match PracticeHub and so does its outstanding figure.
    if (existingPurchaseId && !needsShares && !needsReferenceStamp && !counterSync && !needsOwedStamp && !needsClosedStamp && !needsChargeStamp) continue

    built.push({
      phPackageId: pkg.id,
      patientId: ourPatient.id,
      patientName: ourPatient.name,
      packageName,
      visits: pkg.visits,
      visitsLeft: pkg.visits_left,
      price: pkg.price,
      balance: pkg.balance,
      owing: pkg.owing,
      packageBalance: pkg.package_balance,
      created: pkg.created,
      sessionsTotal: Math.max(visitsTotal, 1),
      sessionsUsed,
      priceCents,
      isActive,
      owedCents,
      repairOnly: existingPurchaseId !== null,
      counterSync,
      usedAheadOfPracticeHub,
      existingPurchaseId,
      needsReferenceStamp,
      needsClosedStamp,
      chargedAtPurchase,
      needsChargeStamp,
      sharedWith: missingShares,
    })
  }

  // Rows here that stand for a bono PracticeHub only has once. Two bonos of
  // the same name and price for one patient on one day is the shape the old
  // `.shift()` matching produced: it handed the single local row to the
  // first PracticeHub bono and inserted a second row for the next one. Six
  // patients here are in that state, each with one row carrying every
  // recorded visit and one carrying none.
  //
  // The test is a count, not a guess: PracticeHub is asked how many bonos of
  // that shape it holds that day, and only a surplus over that number is
  // treated as ours to remove. If PracticeHub really does hold two, the
  // counts match, nothing is proposed, and both rows stay.
  //
  // The row that survives is the one the clinic has been using -- the one
  // with visits recorded against it. The row removed must have no visits, no
  // household members and no invoice, so nothing is lost with it; where it
  // is the row carrying the PracticeHub reference, that reference moves onto
  // the survivor and takes its credit history along.
  const localByShape = new Map<string, LocalBono[]>()
  for (const local of localBonoById.values()) {
    const shapeKey = `${local.patientId}|${local.purchasedAt.slice(0, 10)}|${local.priceCents}|${local.packageName}`
    const list = localByShape.get(shapeKey)
    if (list) list.push(local)
    else localByShape.set(shapeKey, [local])
  }

  // References belonging to a bono this run refuses to import. A local row
  // can be carrying one of these -- which of a PracticeHub pair got written
  // here depended on which one won the old first-come matching -- and that
  // reference must NOT be moved onto the row that survives. Doing so labels
  // the patient's real bono with the phantom's id: the real bono then finds
  // no row under its own reference on the next run, cannot claim a row that
  // now carries someone else's, and inserts a duplicate all over again.
  // Dropping it with the row is right; the real bono stamps its own
  // reference on the survivor in this same pass.
  const skippedPhantomRefs = new Set(phDuplicateBonos.map((d) => `PH-package-${d.phPackageId}`))

  const merges: DuplicateBonoMerge[] = []
  for (const [shapeKey, rows] of localByShape) {
    const phCount = phBonoCountByShape.get(shapeKey) ?? 0
    if (phCount < 1 || rows.length !== phCount + 1) continue

    const removable = rows.filter(
      (r) => r.visitRows === 0 && !r.hasInvoice && !sharedPurchaseIds.has(r.id) && !scheduledPurchaseIds.has(r.id),
    )
    if (removable.length !== 1) continue
    const discard = removable[0]!
    const survivor = [...rows]
      .filter((r) => r.id !== discard.id)
      .sort((a, b) => b.visitRows - a.visitRows || (a.purchasedAt < b.purchasedAt ? -1 : 1))[0]
    if (!survivor || survivor.visitRows === 0) continue
    // A reference can only move onto a row that has none. If both rows carry
    // one, the row being removed may only go if nothing in the ledger points
    // at it -- otherwise its credit would be stranded, so the pair is left
    // alone and shows up in the unmatched list instead. An empty duplicate
    // never had credit written against it, which is what lets the nine
    // PracticeHub-paired rows here be cleaned up.
    const discardCarriesCredit = discard.reference !== null && (creditCentsByPackageRef.get(discard.reference) ?? 0) !== 0
    if (discard.reference !== null && survivor.reference !== null && discardCarriesCredit) continue

    merges.push({
      patientName: ourPatientNameById.get(discard.patientId) ?? discard.patientId,
      packageName: discard.packageName,
      priceCents: discard.priceCents,
      survivorId: survivor.id,
      survivorVisits: survivor.visitRows,
      discardId: discard.id,
      referenceToMove:
        survivor.reference === null && discard.reference !== null && !skippedPhantomRefs.has(discard.reference)
          ? discard.reference
          : null,
    })
  }

  // Anything here that no PracticeHub bono claimed. A bono sold through
  // QuiroFlow since the migration legitimately lands here too, which is why
  // the purchase time is shown: the migration wrote every row it created at
  // exactly midnight, so a row with a real time of day was sold here.
  const mergingAway = new Set(merges.map((m) => m.discardId))
  const leftovers: { patientName: string; bono: LocalBono }[] = []
  for (const local of localBonoById.values()) {
    if (local.reference !== null || claimedPurchaseIds.has(local.id) || mergingAway.has(local.id)) continue
    leftovers.push({ patientName: ourPatientNameById.get(local.patientId) ?? local.patientId, bono: local })
  }
  leftovers.sort((a, b) => a.patientName.localeCompare(b.patientName))

  return {
    candidates: built,
    unmatchedPatients,
    skippedNoValue,
    unmatchedLocalBonos: leftovers,
    phDuplicateBonos,
    voidBonos,
    mispricedBonos,
    duplicateMerges: merges,
  }
}

// --- the server step --------------------------------------------------------------------

type Admin = SupabaseClient<Database>

const PAGE = 1000
/** New bonos inserted per request. */
const INSERT_CHUNK = 200
/** Bonos already here brought up to date between two shouldStop checks. */
const REPAIR_CHUNK = 40
const REPAIR_CONCURRENCY = 8
// The same batch the Ledger step settles in (PracticeHubLedgerImporter's
// SETTLE_BATCH): every changed invoice writes an audit row, and a clinic's
// whole history in one call outran a request's statement timeout.
const SETTLE_BATCH = 2000
/** A guard against looping forever, as in the Ledger step. */
const SETTLE_MAX_CALLS = 200

async function withConcurrency<T>(items: T[], n: number, run: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: n }, async () => { for (let x; (x = queue.shift()) !== undefined;) await run(x) }))
}

/**
 * Every row of one of this account's tables, 1,000 at a time (PostgREST stops
 * at 1,000 without saying so). Scoped to the account by hand: this runs with
 * the service role, which RLS does not scope.
 */
async function readAll<T>(supabase: Admin, accountId: string, table: string, columns: string, narrow?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    let q = (supabase.from(table as never) as any).select(columns).eq('account_id', accountId)
    if (narrow) q = narrow(q)
    const { data, error } = await q.order('id').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

/** One row of the preview per thing the step will do, or will not do and says why. */
export function practiceHubBonosPreview(plan: PracticeHubBonosPlan, t: (en: string, es: string) => string) {
  const columns = [
    { key: 'what', label: t('What', 'Qué') },
    { key: 'patient', label: t('Patient', 'Paciente') },
    { key: 'bono', label: 'Bono' },
    { key: 'detail', label: t('Detail', 'Detalle'), wrap: true },
    { key: 'ph', label: t('PracticeHub id', 'Id de PracticeHub') },
  ]
  const rows: Record<string, string>[] = []

  for (const c of plan.candidates) {
    const detail: string[] = []
    if (!c.repairOnly) detail.push(t(`New bono, ${formatEur(c.priceCents)}`, `Bono nuevo, ${formatEur(c.priceCents)}`))
    if (c.counterSync?.sessionsUsed !== undefined) detail.push(t(`Sessions used → ${c.counterSync.sessionsUsed}`, `Sesiones usadas → ${c.counterSync.sessionsUsed}`))
    if (c.counterSync?.sessionsTotal !== undefined) detail.push(t(`Total sessions → ${c.counterSync.sessionsTotal}`, `Sesiones totales → ${c.counterSync.sessionsTotal}`))
    if (c.counterSync?.priceCents !== undefined) detail.push(t(`Price → ${formatEur(c.counterSync.priceCents)}`, `Precio → ${formatEur(c.counterSync.priceCents)}`))
    if (c.needsClosedStamp) detail.push(c.isActive ? t('Re-opened in PracticeHub', 'Reabierto en PracticeHub') : t('Closed in PracticeHub', 'Cerrado en PracticeHub'))
    if (c.usedAheadOfPracticeHub) detail.push(t('More sessions used here than in PracticeHub: left as it is', 'Más sesiones usadas aquí que en PracticeHub: se deja como está'))
    if (c.owedCents > 0) detail.push(t(`${formatEur(c.owedCents)} still owed on it`, `${formatEur(c.owedCents)} pendiente en el bono`))
    if (c.needsReferenceStamp) detail.push(t('+ PracticeHub reference', '+ referencia de PracticeHub'))
    if (c.needsChargeStamp || (!c.repairOnly && c.chargedAtPurchase)) {
      detail.push(c.chargedAtPurchase
        ? t('Already invoiced in full: its sessions charge nothing', 'Ya facturado entero: sus sesiones no se cobran')
        : t('Sessions charged per visit', 'Sesiones cobradas por visita'))
    }
    if (c.sharedWith.length) detail.push(t(`Shared with ${c.sharedWith.map((m) => m.name).join(', ')}`, `Compartido con ${c.sharedWith.map((m) => m.name).join(', ')}`))
    rows.push({
      what: c.repairOnly ? t('Update', 'Actualizar') : t('New bono', 'Bono nuevo'),
      patient: c.patientName,
      bono: `${c.packageName} · ${c.visitsLeft ?? '—'}/${c.visits ?? '—'}`,
      detail: detail.join(' · '),
      ph: String(c.phPackageId),
    })
  }
  for (const m of plan.duplicateMerges) {
    rows.push({
      what: t('Duplicate removed', 'Duplicado eliminado'),
      patient: m.patientName,
      bono: `${m.packageName} · ${formatEur(m.priceCents)}`,
      // Two t() calls, not one with an English fragment spliced in: the
      // translation catalogue can only translate what reaches t() whole.
      detail: (m.survivorVisits === 1
        ? t('Row kept: 1 visit recorded', 'Fila conservada: 1 visita registrada')
        : t(`Row kept: ${m.survivorVisits} visits recorded`, `Fila conservada: ${m.survivorVisits} visitas registradas`))
        + (m.referenceToMove ? t(` · reference ${m.referenceToMove} moved onto it`, ` · la referencia ${m.referenceToMove} pasa a ella`) : ''),
      ph: '',
    })
  }
  for (const v of plan.voidBonos) {
    rows.push({ what: t('Empty: not imported', 'Vacío: no se importa'), patient: v.patientName, bono: `${v.packageName} · ${formatEur(v.priceCents)}`, detail: '', ph: String(v.phPackageId) })
  }
  for (const d of plan.phDuplicateBonos) {
    rows.push({
      what: t('Listed twice in PracticeHub: not imported', 'Duplicado en PracticeHub: no se importa'),
      patient: d.patientName,
      bono: `${d.packageName} · ${formatEur(d.priceCents)}`,
      detail: d.owedCents > 0 ? t(`${formatEur(d.owedCents)} owed on it in PracticeHub`, `${formatEur(d.owedCents)} pendiente en PracticeHub`) : '',
      ph: String(d.phPackageId),
    })
  }
  for (const m of plan.mispricedBonos) {
    rows.push({
      what: t('Price may be wrong: imported, check it', 'Precio posiblemente incorrecto: se importa, revísalo'),
      patient: m.patientName,
      bono: `${m.packageName} · ${formatEur(m.priceCents)} / ${m.visits}`,
      detail: t(
        `${m.visitsLeft} left implies ${formatEurFromAmount(m.impliedBalance)}, PracticeHub says ${formatEurFromAmount(m.statedBalance)}`,
        `${m.visitsLeft} restantes implican ${formatEurFromAmount(m.impliedBalance)}; PracticeHub indica ${formatEurFromAmount(m.statedBalance)}`,
      ),
      ph: String(m.phPackageId),
    })
  }
  for (const u of plan.unmatchedPatients.values()) {
    rows.push({
      what: t('No matching patient here: skipped', 'Sin paciente aquí: se omite'),
      patient: [u.number, u.name].filter(Boolean).join(' · '),
      bono: u.bonos.join(', '),
      detail: '',
      ph: '',
    })
  }
  for (const { patientName, bono } of plan.unmatchedLocalBonos) {
    rows.push({
      what: t('Here, not in PracticeHub: left alone', 'Aquí, no en PracticeHub: no se toca'),
      patient: patientName,
      bono: `${bono.packageName} · ${formatEur(bono.priceCents)}`,
      detail: t(
        `${bono.sessionsUsed} sessions used · ${bono.visitRows} visits recorded · bought ${bono.purchasedAt.slice(0, 16).replace('T', ' ')}`,
        `${bono.sessionsUsed} sesiones usadas · ${bono.visitRows} visitas registradas · comprado ${bono.purchasedAt.slice(0, 16).replace('T', ' ')}`,
      ),
      ph: '',
    })
  }
  return { columns, rows }
}

/** What the screen's sections say, as counts: no patient is named here, because warnings go into the email the job sends. */
export function practiceHubBonosWarnings(plan: PracticeHubBonosPlan, t: (en: string, es: string) => string): string[] {
  const n = (x: number) => x.toLocaleString('es-ES')
  const out: string[] = []
  const unmatched = plan.unmatchedPatients.size
  if (unmatched) {
    out.push(t(
      `${n(unmatched)} PracticeHub ${unmatched === 1 ? 'patient has' : 'patients have'} no matching record here: their bonos are skipped, and where they share a family bono they cannot draw a session from it. Run the Patients step, then this one again.`,
      `${n(unmatched)} ${unmatched === 1 ? 'paciente de PracticeHub no tiene' : 'pacientes de PracticeHub no tienen'} registro aquí: sus bonos se omiten, y si comparten un bono familiar no pueden usar sesiones de él. Ejecuta el paso Pacientes y vuelve a ejecutar este.`,
    ))
  }
  if (plan.voidBonos.length) {
    out.push(t(
      `${n(plan.voidBonos.length)} empty ${plan.voidBonos.length === 1 ? 'bono' : 'bonos'} in PracticeHub not imported: nothing ever happened on them.`,
      `${n(plan.voidBonos.length)} ${plan.voidBonos.length === 1 ? 'bono vacío' : 'bonos vacíos'} en PracticeHub no se importan: nunca pasó nada en ellos.`,
    ))
  }
  if (plan.mispricedBonos.length) {
    out.push(t(
      `${n(plan.mispricedBonos.length)} ${plan.mispricedBonos.length === 1 ? 'bono' : 'bonos'} whose price may be wrong in PracticeHub: imported as given. Check them in PracticeHub, correct them there and run this again.`,
      `${n(plan.mispricedBonos.length)} ${plan.mispricedBonos.length === 1 ? 'bono' : 'bonos'} con un precio posiblemente incorrecto en PracticeHub: se importan tal cual. Revísalos en PracticeHub, corrígelos allí y vuelve a ejecutar esto.`,
    ))
  }
  if (plan.phDuplicateBonos.length) {
    out.push(t(
      `${n(plan.phDuplicateBonos.length)} ${plan.phDuplicateBonos.length === 1 ? 'bono' : 'bonos'} PracticeHub lists twice not imported: an untouched copy beside a used one of the same name, price and day.`,
      `${n(plan.phDuplicateBonos.length)} ${plan.phDuplicateBonos.length === 1 ? 'bono' : 'bonos'} que PracticeHub lista dos veces no se importan: una copia sin usar junto a otra usada del mismo nombre, precio y día.`,
    ))
  }
  if (plan.duplicateMerges.length) {
    out.push(t(
      `${n(plan.duplicateMerges.length)} ${plan.duplicateMerges.length === 1 ? 'bono' : 'bonos'} recorded twice here: the empty copy is removed, the one with visits kept.`,
      `${n(plan.duplicateMerges.length)} ${plan.duplicateMerges.length === 1 ? 'bono registrado' : 'bonos registrados'} dos veces aquí: se elimina la copia vacía y se conserva la que tiene visitas.`,
    ))
  }
  const ahead = plan.candidates.filter((c) => c.usedAheadOfPracticeHub).length
  if (ahead) {
    out.push(t(
      `${n(ahead)} ${ahead === 1 ? 'bono has' : 'bonos have'} more sessions used here than in PracticeHub: left as they are.`,
      `${n(ahead)} ${ahead === 1 ? 'bono tiene' : 'bonos tienen'} más sesiones usadas aquí que en PracticeHub: se dejan como están.`,
    ))
  }
  if (plan.unmatchedLocalBonos.length) {
    out.push(t(
      `${n(plan.unmatchedLocalBonos.length)} ${plan.unmatchedLocalBonos.length === 1 ? 'bono' : 'bonos'} here that no PracticeHub bono matches: left alone (one sold through QuiroFlow belongs here).`,
      `${n(plan.unmatchedLocalBonos.length)} ${plan.unmatchedLocalBonos.length === 1 ? 'bono' : 'bonos'} aquí sin bono equivalente en PracticeHub: no se tocan (uno vendido en QuiroFlow aparece aquí y es correcto).`,
    ))
  }
  return out
}

export const planBonos: PracticeHubStepPlanner = async (ctx, snapshot): Promise<PracticeHubPlan> => {
  const { supabase, accountId, t } = ctx
  const phPatients = practiceHubList<PHPatient>(snapshot, '/patients')
  const phPackages = practiceHubList<PHPatientPackage>(snapshot, '/patient_packages')

  const [ourPatients, purchases, sessions, shares, schedules, credits] = await Promise.all([
    readAll<PracticeHubBonosInput['ourPatients'][number]>(supabase, accountId, 'patients', 'id, external_reference, email, first_name, last_name'),
    readAll<PracticeHubBonosInput['purchases'][number]>(
      supabase, accountId, 'package_purchases',
      'id, patient_id, purchased_at, external_reference, invoice_id, package_name, price_cents, sessions_used, sessions_total, owed_cents, is_closed, charged_at_purchase',
    ),
    readAll<{ package_purchase_id: string | null }>(supabase, accountId, 'package_sessions', 'package_purchase_id', (q) => q.not('package_purchase_id', 'is', null)),
    readAll<{ package_purchase_id: string; patient_id: string }>(supabase, accountId, 'package_purchase_shares', 'package_purchase_id, patient_id'),
    readAll<{ package_purchase_id: string | null }>(supabase, accountId, 'payment_schedules', 'package_purchase_id', (q) => q.not('package_purchase_id', 'is', null)),
    // Only the references PACKAGE_CREDIT_REF can match: it is anchored on
    // "PH-package-", so nothing else in the ledger counts towards a bono.
    readAll<{ amount_cents: number; external_reference: string | null }>(supabase, accountId, 'account_credits', 'amount_cents, external_reference', (q) => q.like('external_reference', 'PH-package-%')),
  ])

  const plan = planPracticeHubBonos({
    phPatients,
    phPackages,
    ourPatients,
    purchases,
    sessionPurchaseIds: sessions.map((s) => s.package_purchase_id),
    shares,
    scheduledPurchaseIds: schedules.map((s) => s.package_purchase_id),
    credits,
  })
  const { candidates, duplicateMerges } = plan
  const inserts = candidates.filter((c) => !c.repairOnly)
  const repairs = candidates.filter((c) => c.repairOnly)
  const nf = (x: number) => x.toLocaleString('es-ES')
  const { columns, rows } = practiceHubBonosPreview(plan, t)

  // Merges, then every bono to insert or repair, then one unit for settling
  // the invoices again (see apply).
  const total = duplicateMerges.length + candidates.length + 1

  return {
    stats: [
      { label: t('New bonos', 'Bonos nuevos'), value: nf(inserts.length), tone: 'good' },
      { label: t('To update', 'Por actualizar'), value: nf(repairs.length), tone: 'good' },
      { label: t('Changed in PracticeHub', 'Cambiados en PracticeHub'), value: nf(candidates.filter((c) => c.counterSync).length) },
      { label: t('Still owed on them', 'Pendiente en ellos'), value: formatEur(candidates.reduce((sum, c) => sum + c.owedCents, 0)) },
      { label: t('Duplicates removed', 'Duplicados eliminados'), value: nf(duplicateMerges.length) },
      { label: t('Shared with family', 'Compartidos'), value: nf(candidates.filter((c) => c.sharedWith.length).length) },
      { label: t('No patient here', 'Sin paciente aquí'), value: nf(plan.unmatchedPatients.size) },
      { label: t('Active with nothing left', 'Activos sin nada restante'), value: nf(plan.skippedNoValue) },
    ],
    columns,
    rows,
    warnings: practiceHubBonosWarnings(plan, t),
    total,
    async apply(progress, shouldStop) {
      const errors: string[] = []
      let written = 0
      let done = 0
      const tick = () => progress(++done)
      // Where a merge removes a row a candidate points at, the candidate is
      // repointed at the survivor rather than resurrecting it.
      const repoint = new Map<string, string>()

      // Duplicates first, so the rest of the pass writes against the row that
      // survives. One after another, and the first failure stops the rest, as
      // on the screen: they are left alone and the next run retries them.
      for (const m of duplicateMerges) {
        if (shouldStop()) return { written, errors }
        // Delete first, then move the reference: (account_id, external_reference)
        // is unique, so the two rows cannot hold it at once. If the move fails
        // after the delete, the next run repairs it rather than leaving a hole --
        // one PracticeHub bono against one unreferenced row here matches on the
        // day and stamps the reference back on.
        const { error: deleteError } = await supabase.from('package_purchases').delete().eq('id', m.discardId).eq('account_id', accountId)
        if (deleteError) { errors.push(`${m.patientName}: ${deleteError.message}`); break }
        if (m.referenceToMove) {
          const { error: moveError } = await supabase
            .from('package_purchases')
            .update({ external_reference: m.referenceToMove })
            .eq('id', m.survivorId)
            .eq('account_id', accountId)
            .is('external_reference', null)
          if (moveError) { errors.push(`${m.patientName}: ${moveError.message}`); break }
        }
        repoint.set(m.discardId, m.survivorId)
        written++
        tick()
      }
      done = duplicateMerges.length
      progress(done)

      const failed = (c: BonoCandidate, message: string | undefined) => errors.push(`${c.patientName} · ${c.packageName} (PH ${c.phPackageId}): ${message ?? t('not saved', 'no se guardó')}`)

      // The household members sharing a bono. Written after the purchase
      // exists so a newly inserted bono gets its members in the same pass.
      async function insertShares(c: BonoCandidate, purchaseId: string) {
        if (!c.sharedWith.length) return true
        const { error } = await supabase.from('package_purchase_shares').insert(
          c.sharedWith.map((m) => ({ account_id: accountId, package_purchase_id: purchaseId, patient_id: m.id })),
        )
        if (error) { failed(c, error.message); return false }
        return true
      }

      const insertRow = (c: BonoCandidate) => ({
        account_id: accountId,
        patient_id: c.patientId,
        package_name: c.packageName,
        price_cents: c.priceCents,
        sessions_total: c.sessionsTotal,
        sessions_used: c.sessionsUsed,
        purchased_at: c.created,
        external_reference: `PH-package-${c.phPackageId}`,
        owed_cents: c.owedCents,
        // A closed bono is imported as history (see planPracticeHubBonos) and
        // has to arrive saying so, or its leftover sessions read as live.
        is_closed: !c.isActive,
        charged_at_purchase: c.chargedAtPurchase,
      })

      // New bonos, a chunk per request. A chunk the database refuses is tried
      // one bono at a time, so one bad row costs only itself -- the way the
      // screen inserted them.
      for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
        if (shouldStop()) return { written, errors }
        const chunk = inserts.slice(i, i + INSERT_CHUNK)
        const { data, error } = await supabase.from('package_purchases').insert(chunk.map(insertRow)).select('id, external_reference')
        const idOf = new Map<string, string>()
        if (!error) {
          for (const d of data ?? []) if (d.external_reference) idOf.set(d.external_reference, d.id)
        } else {
          for (const c of chunk) {
            const { data: one, error: oneError } = await supabase.from('package_purchases').insert(insertRow(c)).select('id').single()
            if (oneError || !one) failed(c, oneError?.message)
            else idOf.set(`PH-package-${c.phPackageId}`, one.id)
          }
        }
        for (const c of chunk) {
          const purchaseId = idOf.get(`PH-package-${c.phPackageId}`)
          if (purchaseId && await insertShares(c, purchaseId)) written++
          tick()
        }
      }

      // Bonos already here, brought up to what PracticeHub says now.
      async function repair(c: BonoCandidate) {
        const purchaseId = c.existingPurchaseId ? repoint.get(c.existingPurchaseId) ?? c.existingPurchaseId : null
        if (!purchaseId) return false
        const own = () => supabase.from('package_purchases')

        // The outstanding figure on its own, for a bono that needs nothing else.
        // counterSync below already carries it when there is other work to do.
        if (!c.counterSync) {
          await own().update({ owed_cents: c.owedCents }).eq('id', purchaseId).eq('account_id', accountId)
        }

        // PracticeHub has closed (or re-opened) a bono that is already here. Sent
        // on its own rather than folded into counterSync, which is null whenever
        // the counters themselves still agree -- and they do for exactly the case
        // this is for: a bono deactivated with sessions left untouched on it.
        if (c.needsClosedStamp) {
          const { error } = await own().update({ is_closed: !c.isActive }).eq('id', purchaseId).eq('account_id', accountId)
          if (error) { failed(c, error.message); return false }
        }

        // Whether its sessions still cost anything. On its own for the same reason
        // as is_closed: the counters can agree while this does not.
        if (c.needsChargeStamp) {
          const { error } = await own().update({ charged_at_purchase: c.chargedAtPurchase }).eq('id', purchaseId).eq('account_id', accountId)
          if (error) { failed(c, error.message); return false }
        }

        // Bring an already-imported bono up to what PracticeHub says now. Only the
        // fields that actually differ are sent, so a re-run touches nothing it does
        // not have to. See syncFor() for why sessions_used only ever rises.
        if (c.counterSync) {
          const { error } = await own()
            .update({
              ...(c.counterSync.sessionsTotal !== undefined ? { sessions_total: c.counterSync.sessionsTotal } : {}),
              ...(c.counterSync.sessionsUsed !== undefined ? { sessions_used: c.counterSync.sessionsUsed } : {}),
              ...(c.counterSync.priceCents !== undefined ? { price_cents: c.counterSync.priceCents } : {}),
              owed_cents: c.owedCents,
            })
            .eq('id', purchaseId)
            .eq('account_id', accountId)
          if (error) { failed(c, error.message); return false }
        }

        // No account_credits row is written here, for a bono or a correction.
        // A bono's remaining value is the sessions counter and nothing else since
        // 0161 retired the parallel credit, so depositing it again would put back
        // exactly what that migration removed -- and re-open the hole it closed,
        // where a patient holds spendable money AND the sessions it stands for.
        //
        // The corrections this used to propose were wrong on their own terms too:
        // measured against credit attributed to the bono rather than the patient's
        // real balance, they double-removed every session already drawn down here.
        // On the live account 27 of 40 proposed fixes were for patients whose
        // balance was already exactly right, and applying them would have taken
        // 658 EUR off people who owed nothing.

        // Label a bono the hand backfill left unlabelled with its PracticeHub
        // reference, so it stops being matched by date. `is('external_reference',
        // null)` so a reference already there is never overwritten, and the unique
        // index on (account_id, external_reference) refuses a second bono claiming
        // the same PracticeHub id if the day matching ever goes wrong.
        if (c.needsReferenceStamp) {
          const { error } = await own()
            .update({ external_reference: `PH-package-${c.phPackageId}` })
            .eq('id', purchaseId)
            .eq('account_id', accountId)
            .is('external_reference', null)
          if (error) { failed(c, error.message); return false }
        }

        // The outstanding half of a part-paid bono used to be raised here as an
        // unpaid invoice, so that it read as money owed rather than living only in
        // a PracticeHub column.
        //
        // It is not any more. Charges come from the Ledger importer now, one per
        // visit, exactly as PracticeHub records them -- and PracticeHub holds no
        // charge for the unfinished part of a bono. A patient owes for the visits
        // they take; raising an invoice here would invent a debt the source system
        // never asserted, which is the whole class of thing the re-migration
        // removed. What is still owed on a bono remains visible as the difference
        // between its price and what has been paid toward it.
        return insertShares(c, purchaseId)
      }

      for (let i = 0; i < repairs.length; i += REPAIR_CHUNK) {
        if (shouldStop()) return { written, errors }
        await withConcurrency(repairs.slice(i, i + REPAIR_CHUNK), REPAIR_CONCURRENCY, async (c) => {
          if (await repair(c)) written++
          tick()
        })
      }

      // Settle the imported invoices again, as the last unit of work.
      //
      // settle_imported_invoices() pools a family's payments and invoices
      // through package_purchase_shares, which this step writes -- and a full
      // sync runs the Ledger (which settles) BEFORE Bonos. So shares written
      // here would leave a household's invoices settled as if they were
      // strangers until the next Ledger run. It runs on every apply, not only
      // when shares were written: a slice that stopped after writing them and
      // before settling plans again with no shares left to write, and must
      // still settle. Running it with nothing to change changes nothing.
      //
      // In batches, exactly as the Ledger step calls it: each call changes at
      // most SETTLE_BATCH invoices and recomputes the same totals, so a call
      // changing fewer means it is done, and a slice stopped between calls
      // simply settles the rest next time.
      for (let call = 0; call < SETTLE_MAX_CALLS; call++) {
        if (shouldStop()) return { written, errors }
        const { data: settled, error } = await supabase.rpc('settle_imported_invoices', { p_account_id: accountId, p_limit: SETTLE_BATCH })
        if (error) {
          errors.push(t(`Some invoice statuses were not updated from the payments: ${error.message}`, `Algunos estados de factura no se actualizaron con los pagos: ${error.message}`))
          break
        }
        if ((settled ?? 0) < SETTLE_BATCH) break
      }
      progress(total)
      return { written, errors }
    },
  }
}
