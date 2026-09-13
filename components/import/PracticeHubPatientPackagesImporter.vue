<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

// first_name/last_name are optional because nothing else here needs them and
// PracticeHub's docs do not promise them -- they are used only to put a name
// next to an unmatched patient number, and the number alone still works.
interface PHPatient { id: number; patient_number: string; email?: string | null; first_name?: string | null; last_name?: string | null }
interface PHPatientPackage {
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
  price: number | null
  balance: number | null
  owing: number | null
  package_balance: number | null
  created: string
}

function patientIdOf(pkg: PHPatientPackage): number | null {
  return pkg.patient_id ?? pkg.subscribed_patients?.[0]?.patient_id ?? null
}

// A PracticeHub bono can be subscribed to several patients -- a family bono
// the household shares. Only the first was ever read, so the bono landed
// against one member and the rest had no way to draw a session from it.
// Everyone after the owner becomes a package_purchase_shares row.
function sharedPatientIdsOf(pkg: PHPatientPackage, ownerPhId: number | null): number[] {
  const ids = (pkg.subscribed_patients ?? []).map((sp) => sp.patient_id)
  return [...new Set(ids)].filter((id) => id !== ownerPhId)
}

interface Candidate {
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
  // The other patients PracticeHub has subscribed to this bono -- a family
  // bono the whole household draws sessions from. Owner excluded.
  sharedWith: { id: string; name: string }[]
  status: 'pending' | 'applied' | 'error'
  errorMessage?: string
}

// A bono row as it exists here, carried through matching so a PracticeHub
// bono can claim the row that actually corresponds to it rather than
// whichever one happens to be first.
interface LocalBono {
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
}

const stage = ref<'connect' | 'loading' | 'preview' | 'applying' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const candidates = ref<Candidate[]>([])
// Who was skipped, not just how many. This used to be a bare counter, and it
// counted per bono rather than per person: someone on three bonos was three
// "unmatched patients". Worse, the count named nobody, so a real gap -- a
// patient PracticeHub knows and we do not, whose bonos and shares are silently
// dropped by every importer -- was a number on a screen with no way to act on
// it. Keyed by PracticeHub patient id, so each person appears once, with the
// bonos they were skipped on.
const unmatchedPatients = ref(new Map<string, { number: string; name: string; bonos: string[] }>())
const skippedUnmatched = computed(() => unmatchedPatients.value.size)
const skippedNoValue = ref(0)
// Bonos that exist here but that no PracticeHub bono claimed. Before this
// existed the importer could hand one local row to the first bono of a
// same-day pair and insert a fresh row for the second, leaving a duplicate
// nothing ever mentioned -- six patients ended up with two rows for one
// bono, and only a hand-written SQL query found them. Anything left over
// after matching is now reported instead of ignored.
const unmatchedLocalBonos = ref<{ patientName: string; bono: LocalBono }[]>([])
// Bono rows here that stand for the same PracticeHub bono as another row.
// Decided by counting: when this patient has more rows of a given bono on a
// given day than PracticeHub has bonos, the surplus is ours, not theirs.
// Bonos PracticeHub itself holds twice. Nine patients here already carry the
// result: two rows of the same name, price and day, the earlier id completely
// untouched and the later one holding all the usage. That is PracticeHub's
// shape, not ours -- consecutive ids, the first never used. Importing the
// empty one gives the patient a whole extra bono of sessions they never
// bought, and where PracticeHub also reports it as unpaid it would raise an
// invoice for money nobody owes.
const phDuplicateBonos = ref<{ patientName: string; packageName: string; priceCents: number; phPackageId: number; owedCents: number }[]>([])
// Bonos PracticeHub still lists but on which nothing ever happened: no
// session used, no balance, nothing owed, nobody sharing them.
const voidBonos = ref<{ patientName: string; packageName: string; priceCents: number; phPackageId: number }[]>([])
const mergesApplied = ref(0)
const mergeError = ref('')
const duplicateMerges = ref<
  {
    patientName: string
    packageName: string
    priceCents: number
    survivorId: string
    survivorVisits: number
    discardId: string
    // Moved onto the survivor when the row being removed is the one carrying
    // the PracticeHub reference, so its credit history stays attached.
    referenceToMove: string | null
  }[]
>([])

// Raw, untouched sample of what PracticeHub actually returns -- the field
// mapping above is a guess reverse-engineered from the docs' example
// response, which has already been wrong twice. Showing this directly
// avoids another guess-and-redeploy round trip.
const rawSample = ref<unknown[]>([])
const showRawSample = ref(false)

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
// Checked against real payment history: Antonio Guillem 440 + (-240) = 200
// paid of a 480 bono with 1 of 12 taken; Mariana Arango 516 + (-301) = 215;
// Jose Soler Gil 484 + (-264) = 220; Blanca Vidal, fully paid, 360 + 0 = 360.
//
// Using `balance` alone -- as this did -- credits the whole entitlement and
// hands part-payers money they never paid: 440 instead of 200 for Antonio.
// Using `package_balance` alone is worse still, since it is negative wherever
// anything is owed.
//
// Clamped at zero: 8 packages are over-used and carry a negative balance, and
// a patient cannot hold negative prepaid credit -- extra visits owed are an
// invoice, not a credit.
//
// Caveat worth knowing before a big run: `package_balance` is only as good as
// PracticeHub's own payment linking. Where their staff took a payment without
// linking it to the bono (Aurelia Villalba: PH reports 602 outstanding, she
// actually paid 301) PH under-reports what was paid, so this under-reads.
// It never over-reads, which is the safer direction, and the reconciliation
// report is where those show up.
//
// This no longer drives any write. A bono's remaining value lives on the
// sessions counter alone (0161), so the only thing left to ask of this figure
// is whether a cancelled bono was ever paid for -- see neverUsedAndEmpty.
function paidNotConsumedCentsFor(pkg: PHPatientPackage): number {
  const paidMinusConsumed = (pkg.balance ?? 0) + (pkg.package_balance ?? 0)
  return Math.max(0, Math.round(paidMinusConsumed * 100))
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
function owedCentsFor(pkg: PHPatientPackage): number {
  return Math.max(0, Math.round(-(pkg.package_balance ?? 0) * 100))
}

// What to change on a bono already here so it reads what PracticeHub reads.
//
// A bono is imported once and then never looked at again, so whatever
// PracticeHub said that day is frozen here forever. That is fine until the
// clinic corrects PracticeHub -- which is exactly what onboarding is: the
// source data gets cleaned while the migration is already running. Adrian
// Hernandez's bono came over as 11 sessions at 440 EUR because that is what
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
function syncFor(local: LocalBono, phSessionsTotal: number, phSessionsUsed: number, phPriceCents: number) {
  const sync: { sessionsTotal?: number; sessionsUsed?: number; priceCents?: number } = {}
  if (phSessionsTotal > 0 && local.sessionsTotal !== phSessionsTotal) sync.sessionsTotal = phSessionsTotal
  if (phPriceCents > 0 && local.priceCents !== phPriceCents) sync.priceCents = phPriceCents
  if (phSessionsUsed > local.sessionsUsed) sync.sessionsUsed = phSessionsUsed
  return {
    counterSync: Object.keys(sync).length > 0 ? sync : null,
    usedAheadOfPracticeHub: phSessionsUsed < local.sessionsUsed,
  }
}

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'loading'
  runError.value = ''
  candidates.value = []
  unmatchedPatients.value = new Map()
  unmatchedLocalBonos.value = []
  duplicateMerges.value = []
  phDuplicateBonos.value = []
  voidBonos.value = []
  mergesApplied.value = 0
  mergeError.value = ''
  skippedNoValue.value = 0
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const phPatients = await api.fetchAll<PHPatient>('/patients', (done, total) => (progress.value = { done, total }))
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
      const entry = unmatchedPatients.value.get(key) ?? {
        number: (phId !== null ? patientNumberById.get(String(phId)) : null) ?? '(no patient number)',
        name: (phId !== null ? patientNameById.get(String(phId)) : '') || '',
        bonos: [],
      }
      if (!entry.bonos.includes(bonoName)) entry.bonos.push(bonoName)
      unmatchedPatients.value.set(key, entry)
    }

    const PAGE_SIZE = 1000
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
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('patients').select('id, external_reference, email, first_name, last_name').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const p of data ?? []) {
        const name = `${p.first_name} ${p.last_name ?? ''}`.trim()
        ourPatientNameById.set(p.id, name)
        if (p.external_reference) ourPatientByRef.set(p.external_reference, { id: p.id, name })
        const email = p.email?.trim().toLowerCase()
        if (email) {
          ourEmailCount.set(email, (ourEmailCount.get(email) ?? 0) + 1)
          ourPatientByEmail.set(email, { id: p.id, name })
        }
      }
      if (!data || data.length < PAGE_SIZE) break
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
    phase.value = t('Checking for already-imported packages…', 'Comprobando bonos ya importados…')
    const purchaseByRef = new Map<string, string>()
    const localBonoById = new Map<string, LocalBono>()
    // A LIST per day, not a single id. Two PracticeHub bonos created on the
    // same day for the same patient used to both resolve to the same local
    // row, and each then took back the same deposit: Oscar Inga's two bonos
    // both claimed his one 360 EUR row and clawed it back twice, leaving him
    // at -280 EUR. Each local row is now claimed by at most one bono, and a
    // bono that finds nothing left to claim is a genuinely new one to insert.
    const purchasesByPatientDay = new Map<string, LocalBono[]>()
    // Rows carrying no PracticeHub reference: the bonos the hand backfill
    // created. The importer recognises them by patient and day, but never
    // wrote the reference onto them, so nothing downstream can see they are
    // the same bono -- the migration check counts by reference and reported
    // 188 of them as missing from a set that is entirely present.
    const purchaseNeedsReference = new Set<string>()
    // Bonos that already have their household members attached, so a re-run
    // does not add the same person to the same bono twice.
    const purchaseHasShares = new Set<string>()
    // Same rows, keyed by bono alone -- used to refuse to remove a bono that
    // a household is attached to.
    const sharedPurchaseIds = new Set<string>()
    // Instalment plans. payment_schedules cascades on delete, so a bono
    // carrying one is never a candidate for removal however empty it looks.
    const scheduledPurchaseIds = new Set<string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('package_purchases')
        .select('id, patient_id, purchased_at, external_reference, invoice_id, package_name, price_cents, sessions_used, sessions_total, owed_cents')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) {
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
      if (!data || data.length < PAGE_SIZE) break
    }

    // Visits recorded against each bono. A leftover row carrying visits is
    // the one the clinic has actually been drawing sessions from, which is
    // what makes it safe to say which of a duplicated pair is the live one.
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_sessions').select('package_purchase_id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) {
        const local = row.package_purchase_id ? localBonoById.get(row.package_purchase_id) : undefined
        if (local) local.visitRows++
      }
      if (!data || data.length < PAGE_SIZE) break
    }

    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_purchase_shares').select('package_purchase_id, patient_id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      // Per member, not per bono. Testing only "does this bono have any
      // shares" meant a bono someone was added to already could never gain
      // the rest of the household: the first member made it look done.
      for (const row of data ?? []) {
        purchaseHasShares.add(`${row.package_purchase_id}|${row.patient_id}`)
        sharedPurchaseIds.add(row.package_purchase_id)
      }
      if (!data || data.length < PAGE_SIZE) break
    }

    for (let page = 0; ; page++) {
      const { data } = await supabase.from('payment_schedules').select('package_purchase_id').not('package_purchase_id', 'is', null).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) if (row.package_purchase_id) scheduledPurchaseIds.add(row.package_purchase_id)
      if (!data || data.length < PAGE_SIZE) break
    }


    // Which bonos have credit rows pointing at them. Nothing here writes credit
    // any more, but the duplicate merge below DELETES a redundant bono row, and
    // deleting one the ledger still references would strand that credit. 0161
    // offsets the retired bono credit rather than deleting it, so those rows
    // are still there to be stranded and this guard still has work to do.
    //
    // Anchored on the exact forms this importer used to write -- PH-package-12,
    // PH-package-12-adjustment, PH-package-12-adjustment-2 -- and nothing else.
    // A looser "starts with PH-package-12" once swallowed a hand-written repair
    // (PH-package-479-duplicate-record-adjustment, correcting a duplicate on a
    // different patient record entirely) into bono 479's total.
    const PACKAGE_CREDIT_REF = /^(PH-package-\d+)(?:-adjustment(?:-\d+)?)?$/
    phase.value = t('Checking existing credit…', 'Comprobando el crédito existente…')
    const creditCentsByPackageRef = new Map<string, number>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('account_credits')
        .select('amount_cents, external_reference')
        .not('external_reference', 'is', null)
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) {
        const base = row.external_reference ? PACKAGE_CREDIT_REF.exec(row.external_reference)?.[1] : undefined
        if (base) creditCentsByPackageRef.set(base, (creditCentsByPackageRef.get(base) ?? 0) + row.amount_cents)
      }
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Fetching patient packages…', 'Obteniendo bonos de pacientes…')
    progress.value = { done: 0, total: 0 }
    const phPackages = await api.fetchAll<PHPatientPackage>('/patient_packages', (done, total) => (progress.value = { done, total }))
    rawSample.value = phPackages.slice(0, 3)

    const built: Candidate[] = []
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
    // those rows -- Silvia Santori has one deposit of 322 EUR, a -322
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
        phDuplicateBonos.value.push({
          patientName: ourPatient.name,
          packageName,
          priceCents,
          phPackageId: pkg.id,
          owedCents: isActive ? owedCentsFor(pkg) : 0,
        })
        continue
      }

      // A cancelled record: PracticeHub deactivated it and not one session was
      // ever drawn on it. Pablo Girelli has two Bono 12s dated 22 July ten
      // minutes apart -- 12/12 remaining, price 528, balance 528,
      // package_balance -528, deactivated -- while PracticeHub's own billing
      // screen for him shows a single 70 EUR first visit and no bonos at all.
      // Importing them hands a patient 24 sessions they never bought.
      //
      // The discriminator is deactivated AND untouched. A bono that was
      // genuinely spent is deactivated too, but has sessions used against it.
      // One bought and not yet started is still active. And a cancelled bono
      // the patient had already PAID for is money they are owed
      // (balance + package_balance > 0), so requiring zero there keeps it
      // visible instead of quietly dropping it -- Pablo's two net to zero,
      // 528 + -528, because nothing was ever paid on them. That case wants a
      // refund or a goodwill balance decided by a human, which is why it is
      // surfaced rather than resolved here.
      const neverUsedAndEmpty =
        !isActive &&
        sessionsUsedOfPkg === 0 &&
        paidNotConsumedCentsFor(pkg) === 0 &&
        sharedPatientIdsOf(pkg, phPatientId).length === 0
      if (neverUsedAndEmpty) {
        voidBonos.value.push({ patientName: ourPatient.name, packageName, priceCents, phPackageId: pkg.id })
        continue
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
          skippedNoValue.value++
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

      // Nothing left to do: the bono is here, its household is attached, its
      // counters match PracticeHub and so does its outstanding figure.
      if (existingPurchaseId && !needsShares && !needsReferenceStamp && !counterSync && !needsOwedStamp) continue

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
        sharedWith: missingShares,
        status: 'pending',
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
    const skippedPhantomRefs = new Set(phDuplicateBonos.value.map((d) => `PH-package-${d.phPackageId}`))

    const merges: typeof duplicateMerges.value = []
    for (const [shapeKey, rows] of localByShape) {
      const phCount = phBonoCountByShape.get(shapeKey) ?? 0
      if (phCount < 1 || rows.length !== phCount + 1) continue

      const removable = rows.filter(
        (r) => r.visitRows === 0 && !r.hasInvoice && !sharedPurchaseIds.has(r.id) && !scheduledPurchaseIds.has(r.id),
      )
      if (removable.length !== 1) continue
      const discard = removable[0]
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
    duplicateMerges.value = merges

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
    unmatchedLocalBonos.value = leftovers

    candidates.value = built
    stage.value = 'preview'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

async function applyFixes() {
  stage.value = 'applying'
  const toApply = candidates.value.filter((c) => c.status === 'pending')
  progress.value = { done: 0, total: toApply.length }

  // Duplicates first, so the rest of the pass writes against the row that
  // survives. A candidate pointing at the row being removed is repointed at
  // the survivor rather than resurrecting it.
  mergeError.value = ''
  mergesApplied.value = 0
  for (const m of duplicateMerges.value) {
    // Delete first, then move the reference: (account_id, external_reference)
    // is unique, so the two rows cannot hold it at once. If the move fails
    // after the delete, the next run repairs it rather than leaving a hole --
    // one PracticeHub bono against one unreferenced row here matches on the
    // day and stamps the reference back on.
    const { error: deleteError } = await supabase.from('package_purchases').delete().eq('id', m.discardId)
    if (deleteError) {
      mergeError.value = `${m.patientName}: ${deleteError.message}`
      break
    }
    if (m.referenceToMove) {
      const { error: moveError } = await supabase
        .from('package_purchases')
        .update({ external_reference: m.referenceToMove })
        .eq('id', m.survivorId)
        .is('external_reference', null)
      if (moveError) {
        mergeError.value = `${m.patientName}: ${moveError.message}`
        break
      }
    }
    for (const c of toApply) if (c.existingPurchaseId === m.discardId) c.existingPurchaseId = m.survivorId
    mergesApplied.value++
  }

  for (const c of toApply) {
    const externalRef = `PH-package-${c.phPackageId}`
    let purchaseId = c.existingPurchaseId

    // A repair leaves the existing purchase row untouched and only adds the
    // invoice, reference and shares it never got.
    if (!c.repairOnly) {
      const { data: purchase, error: purchaseError } = await supabase
        .from('package_purchases')
        .insert({
          account_id: store.accountId!,
          patient_id: c.patientId,
          package_name: c.packageName,
          price_cents: c.priceCents,
          sessions_total: c.sessionsTotal,
          sessions_used: c.sessionsUsed,
          purchased_at: c.created,
          external_reference: externalRef,
          owed_cents: c.owedCents,
        })
        .select('id')
        .single()

      if (purchaseError || !purchase) {
        c.status = 'error'
        c.errorMessage = purchaseError?.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
      purchaseId = purchase.id
    }

    // The outstanding figure on its own, for a bono that needs nothing else.
    // counterSync above already carries it when there is other work to do.
    if (c.repairOnly && !c.counterSync && purchaseId) {
      await supabase.from('package_purchases').update({ owed_cents: c.owedCents }).eq('id', purchaseId)
    }

    // Bring an already-imported bono up to what PracticeHub says now. Only the
    // fields that actually differ are sent, so a re-run touches nothing it does
    // not have to. See syncFor() for why sessions_used only ever rises.
    if (c.counterSync && purchaseId) {
      const { error: syncError } = await supabase
        .from('package_purchases')
        .update({
          ...(c.counterSync.sessionsTotal !== undefined ? { sessions_total: c.counterSync.sessionsTotal } : {}),
          ...(c.counterSync.sessionsUsed !== undefined ? { sessions_used: c.counterSync.sessionsUsed } : {}),
          ...(c.counterSync.priceCents !== undefined ? { price_cents: c.counterSync.priceCents } : {}),
          owed_cents: c.owedCents,
        })
        .eq('id', purchaseId)
      if (syncError) {
        c.status = 'error'
        c.errorMessage = syncError.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
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
    if (c.needsReferenceStamp && purchaseId) {
      const { error: stampError } = await supabase
        .from('package_purchases')
        .update({ external_reference: externalRef })
        .eq('id', purchaseId)
        .is('external_reference', null)
      if (stampError) {
        c.status = 'error'
        c.errorMessage = stampError.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
    }

    // The household members sharing this bono. Written after the purchase
    // exists so a newly inserted bono gets its members in the same pass.
    if (c.sharedWith.length > 0 && purchaseId) {
      const { error: shareError } = await supabase.from('package_purchase_shares').insert(
        c.sharedWith.map((m) => ({
          account_id: store.accountId!,
          package_purchase_id: purchaseId as string,
          patient_id: m.id,
        })),
      )
      if (shareError) {
        c.status = 'error'
        c.errorMessage = shareError.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
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

    c.status = 'applied'
    progress.value = { done: progress.value.done + 1, total: toApply.length }
  }

  stage.value = 'done'
  const mergeNote = mergesApplied.value > 0 ? ` ${t(`Merged ${mergesApplied.value} duplicate bono(s).`, `Se fusionaron ${mergesApplied.value} bono(s) duplicados.`)}` : ''
  showToast(
    t(
      `Applied ${candidates.value.filter((c) => c.status === 'applied').length} fix(es).${mergeNote}`,
      `Se aplicaron ${candidates.value.filter((c) => c.status === 'applied').length} corrección(es).${mergeNote}`,
    ),
    candidates.value.some((c) => c.status === 'error') || mergeError.value ? 'error' : 'success',
  )
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  candidates.value = []
  unmatchedPatients.value = new Map()
  unmatchedLocalBonos.value = []
  duplicateMerges.value = []
  phDuplicateBonos.value = []
  voidBonos.value = []
  mergesApplied.value = 0
  mergeError.value = ''
  skippedNoValue.value = 0
  progress.value = { done: 0, total: 0 }
}

function formatEuros(cents: number): string {
  return (cents / 100).toFixed(2)
}
const introLead = computed(() =>
  t(
    'Brings bonos across from PracticeHub, and brings ones imported earlier back in line with what PracticeHub says about them now.',
    'Trae los bonos desde PracticeHub y pone al día los que se importaron antes con lo que PracticeHub dice ahora de ellos.',
  ),
)
const introNotes = computed(() => [
  {
    title: t('A bono is sessions, not account credit.', 'Un bono son sesiones, no saldo en la cuenta.'),
    body: t(
      'What is left on a bono is the sessions counter, and this importer writes no account credit for one. PracticeHub reads it the same way -- its balance column is sessions left x the per-session rate.',
      'Lo que queda de un bono es el contador de sesiones, y este importador no escribe saldo por un bono. PracticeHub lo lee igual: su columna balance son las sesiones restantes por el precio de cada sesión.',
    ),
  },
  {
    title: t('It corrects bonos PracticeHub has since changed.', 'Corrige los bonos que PracticeHub ha cambiado desde entonces.'),
    body: t(
      'Sessions, total and price are brought back in line. Sessions used only ever rises: PracticeHub knowing about a visit we do not is normal, but lowering the count would hand a patient back sessions they already took, so that case is reported instead of written.',
      'Sesiones, total y precio se ponen al día. Las sesiones usadas solo suben: que PracticeHub sepa de una visita que aquí no consta es normal, pero bajar el contador devolvería al paciente sesiones ya consumidas, así que ese caso solo se informa.',
    ),
  },
  {
    title: t('What is still owed becomes an unpaid invoice.', 'Lo que queda por pagar se convierte en una factura pendiente.'),
    body: t(
      'Only the outstanding part is billed, and only on an active bono -- the half already paid came over with the payments importer, so invoicing the full price again would double the clinic takings.',
      'Solo se factura la parte pendiente, y solo en un bono activo: la parte ya pagada vino con el importador de pagos, así que volver a facturar el precio completo duplicaría los ingresos.',
    ),
  },
  {
    title: t('Nothing is written until you press Apply.', 'No se escribe nada hasta que pulses Aplicar.'),
    body: t(
      "The preview shows PracticeHub's own price, balance, owing and package_balance columns, so you can check them against a patient you already know. Safe to run again: bonos already correct are skipped.",
      'La vista previa muestra las columnas price, balance, owing y package_balance de PracticeHub, para que las compruebes con un paciente que ya conozcas. Se puede volver a ejecutar: los bonos ya correctos se omiten.',
    ),
  },
])
</script>

<template>
  <div>
    <ImportIntro :lead="introLead" :notes="introNotes" />

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'loading'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Import failed:', 'Fallo en la importación:') }}</p>
        <p class="mt-1">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover" @click="retryRun">
        {{ t('Retry', 'Reintentar') }}
      </button>
    </div>

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-line bg-surface-subtle p-3 text-sm text-ink-muted2">
        {{
          t(
            `Found ${candidates.filter((c) => c.status === 'pending' && !c.repairOnly).length} new bono(s) to add and ${candidates.filter((c) => c.status === 'pending' && c.repairOnly).length} already here that need updating. Bonos PracticeHub has since changed: ${candidates.filter((c) => c.counterSync).length}. Still owed across these bonos: €${formatEuros(candidates.reduce((sum, c) => sum + c.owedCents, 0))} (not charged -- PracticeHub holds no invoice for it). Skipped: ${skippedUnmatched} unmatched patients, ${skippedNoValue} active bonos with nothing left on them.`,
            `Se encontraron ${candidates.filter((c) => c.status === 'pending' && !c.repairOnly).length} bono(s) nuevos y ${candidates.filter((c) => c.status === 'pending' && c.repairOnly).length} ya existentes que hay que actualizar. Bonos que PracticeHub ha cambiado desde entonces: ${candidates.filter((c) => c.counterSync).length}. Pendiente en estos bonos: €${formatEuros(candidates.reduce((sum, c) => sum + c.owedCents, 0))} (no se factura: PracticeHub no tiene ninguna factura por ello). Omitidos: ${skippedUnmatched} pacientes sin emparejar, ${skippedNoValue} bonos activos sin saldo restante.`,
          )
        }}
      </div>

      <div v-if="skippedUnmatched > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${skippedUnmatched} patient(s) in PracticeHub have no matching record here`, `${skippedUnmatched} paciente(s) de PracticeHub no tienen registro aqu\u00ed`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{ t('Their bonos are skipped, and where they share a family bono they cannot draw a session from it. Match them by running the Patients import, then run this again. A patient number showing here and nothing in QuiroFlow usually means their reference was never stored, not that the patient is missing.', 'Sus bonos se omiten, y si comparten un bono familiar no pueden usar sesiones de \u00e9l. Emparéjalos ejecutando la importaci\u00f3n de Pacientes y vuelve a ejecutar esto. Un n\u00famero de paciente aqu\u00ed sin nada en QuiroFlow suele significar que su referencia nunca se guard\u00f3, no que falte el paciente.') }}
        </p>
        <ul class="mt-2 space-y-0.5 text-[12px] text-warning-text">
          <li v-for="[key, u] in [...unmatchedPatients]" :key="key">
            <span class="font-mono">{{ u.number }}</span>
            <template v-if="u.name"> &middot; {{ u.name }}</template>
            <span class="text-warning-text/70"> &middot; {{ u.bonos.join(', ') }}</span>
          </li>
        </ul>
      </div>

      <div v-if="voidBonos.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${voidBonos.length} empty bono(s) in PracticeHub — not imported`, `${voidBonos.length} bono(s) vacíos en PracticeHub: no se importan`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{
            t(
              'Nothing ever happened on these: no session used, no balance left, nothing owed, nobody sharing them. Importing one hands the patient a bono of sessions they never bought. A bono that was genuinely used up has sessions against it, and one bought and untouched still carries its balance, so neither is affected.',
              'En estos nunca pasó nada: ninguna sesión usada, sin saldo, sin nada pendiente y sin pacientes compartidos. Importar uno daría al paciente un bono de sesiones que nunca compró. Un bono realmente consumido tiene sesiones usadas, y uno comprado y sin usar conserva su saldo, así que ninguno de los dos se ve afectado.',
            )
          }}
        </p>
        <ul class="mt-2 space-y-0.5 text-[12px] text-warning-text">
          <li v-for="v in voidBonos" :key="v.phPackageId">
            {{ v.patientName }} &middot; {{ v.packageName }} &middot; &euro;{{ formatEuros(v.priceCents) }}
            <span class="font-mono text-warning-text/70">#{{ v.phPackageId }}</span>
          </li>
        </ul>
      </div>

      <div v-if="phDuplicateBonos.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${phDuplicateBonos.length} bono(s) PracticeHub lists twice — not imported`, `${phDuplicateBonos.length} bono(s) que PracticeHub lista dos veces: no se importan`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{
            t(
              'For each of these, PracticeHub holds a second bono of the same name, price and day that has actually been used, while this one has never been touched. Importing it would give the patient a second bono of sessions they never bought, and where PracticeHub reports it unpaid it would raise an invoice for money nobody owes. Nothing is written for them. If one of these is a real second purchase, say so and it can be brought in.',
              'Para cada uno de estos, PracticeHub tiene un segundo bono del mismo nombre, precio y día que sí se ha usado, mientras que este no se ha tocado nunca. Importarlo daría al paciente un segundo bono de sesiones que nunca compró, y si PracticeHub lo marca como impagado generaría una factura por dinero que nadie debe. No se escribe nada para ellos. Si alguno es una segunda compra real, dilo y se puede importar.',
            )
          }}
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-[12px] text-warning-text">
            <thead class="text-left text-warning-text/70">
              <tr>
                <th class="py-1 pr-3 font-medium">{{ t('Patient', 'Paciente') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Bono', 'Bono') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Price', 'Precio') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('PracticeHub id', 'Id de PracticeHub') }}</th>
                <th class="py-1 font-medium">{{ t('Invoice avoided', 'Factura evitada') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in phDuplicateBonos" :key="d.phPackageId">
                <td class="py-1 pr-3">{{ d.patientName }}</td>
                <td class="py-1 pr-3">{{ d.packageName }}</td>
                <td class="py-1 pr-3">&euro;{{ formatEuros(d.priceCents) }}</td>
                <td class="py-1 pr-3 font-mono">{{ d.phPackageId }}</td>
                <td class="py-1" :class="d.owedCents > 0 ? 'font-medium' : 'text-warning-text/70'">
                  <template v-if="d.owedCents > 0">&euro;{{ formatEuros(d.owedCents) }}</template>
                  <template v-else>&mdash;</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="duplicateMerges.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${duplicateMerges.length} bono(s) recorded twice here — one row will be removed from each`, `${duplicateMerges.length} bono(s) registrados dos veces aquí: se eliminará una fila de cada uno`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{
            t(
              'PracticeHub holds one bono of this shape for this patient on this day, and there are two here. The row kept is the one the clinic has been using — the one with visits recorded against it — and the row removed has no visits, no household members, no invoice and no instalment plan, so nothing is lost with it. Where the removed row is the one carrying the PracticeHub reference, that reference moves onto the row that stays and takes its credit history along.',
              'PracticeHub tiene un bono de esta forma para este paciente ese día, y aquí hay dos. Se conserva la fila que la clínica ha estado usando (la que tiene visitas registradas) y la que se elimina no tiene visitas, ni pacientes compartidos, ni factura, ni plan de pago, así que no se pierde nada. Si la fila eliminada es la que lleva la referencia de PracticeHub, esa referencia pasa a la fila que se conserva junto con su historial de crédito.',
            )
          }}
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-[12px] text-warning-text">
            <thead class="text-left text-warning-text/70">
              <tr>
                <th class="py-1 pr-3 font-medium">{{ t('Patient', 'Paciente') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Bono', 'Bono') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Price', 'Precio') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Row kept', 'Fila conservada') }}</th>
                <th class="py-1 font-medium">{{ t('Reference moved', 'Referencia movida') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in duplicateMerges" :key="m.discardId">
                <td class="py-1 pr-3">{{ m.patientName }}</td>
                <td class="py-1 pr-3">{{ m.packageName }}</td>
                <td class="py-1 pr-3">&euro;{{ formatEuros(m.priceCents) }}</td>
                <td class="py-1 pr-3">{{ t(`${m.survivorVisits} visit(s) recorded`, `${m.survivorVisits} visita(s) registradas`) }}</td>
                <td class="py-1 font-mono">{{ m.referenceToMove ?? t('—', '—') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="unmatchedLocalBonos.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${unmatchedLocalBonos.length} bono(s) here that no PracticeHub bono matches`, `${unmatchedLocalBonos.length} bono(s) aquí sin bono equivalente en PracticeHub`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{
            t(
              'Nothing is done to these — they are listed so you can see them. A bono sold through QuiroFlow since the migration belongs here and is fine. One bought at exactly 00:00 came from the migration, and if the same patient also has a PracticeHub-referenced bono of the same size on the same day, the two are the same bono recorded twice: the sessions column tells you which one the clinic has actually been using.',
              'No se hace nada con estos: se listan para que puedas verlos. Un bono vendido en QuiroFlow después de la migración aparece aquí y es correcto. Uno comprado exactamente a las 00:00 viene de la migración, y si el mismo paciente tiene además un bono con referencia de PracticeHub del mismo tamaño y el mismo día, son el mismo bono registrado dos veces: la columna de sesiones indica cuál ha estado usando la clínica.',
            )
          }}
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-[12px] text-warning-text">
            <thead class="text-left text-warning-text/70">
              <tr>
                <th class="py-1 pr-3 font-medium">{{ t('Patient', 'Paciente') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Bono', 'Bono') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Price', 'Precio') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Sessions used', 'Sesiones usadas') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Visits recorded', 'Visitas registradas') }}</th>
                <th class="py-1 font-medium">{{ t('Bought', 'Comprado') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in unmatchedLocalBonos" :key="row.bono.id">
                <td class="py-1 pr-3">{{ row.patientName }}</td>
                <td class="py-1 pr-3">{{ row.bono.packageName }}</td>
                <td class="py-1 pr-3">&euro;{{ formatEuros(row.bono.priceCents) }}</td>
                <td class="py-1 pr-3">{{ row.bono.sessionsUsed }}</td>
                <td class="py-1 pr-3">{{ row.bono.visitRows }}</td>
                <td class="py-1 whitespace-nowrap">{{ row.bono.purchasedAt.slice(0, 16).replace('T', ' ') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="skippedUnmatched > 0 || candidates.filter((c) => c.status === 'pending').length === 0" class="rounded-lg border border-line">
        <button type="button" class="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-ink-700" @click="showRawSample = !showRawSample">
          <span>{{ t('Debug: raw PracticeHub response (first 3)', 'Depurar: respuesta cruda de PracticeHub (primeros 3)') }}</span>
          <span class="text-ink-muted2">{{ showRawSample ? '▲' : '▼' }}</span>
        </button>
        <pre v-if="showRawSample" class="overflow-x-auto border-t border-line bg-surface-subtle p-3 text-[11px] leading-relaxed text-ink-700">{{ JSON.stringify(rawSample, null, 2) }}</pre>
      </div>

      <div class="overflow-x-auto rounded-lg border border-line">
        <table class="w-full text-left text-xs">
          <thead class="bg-surface-subtle text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-3 py-2">{{ t('Package', 'Bono') }}</th>
              <th class="px-3 py-2">{{ t('Visits', 'Visitas') }}</th>
              <th class="px-3 py-2">price</th>
              <th class="px-3 py-2">balance</th>
              <th class="px-3 py-2">owing</th>
              <th class="px-3 py-2">package_balance</th>
              <th class="px-3 py-2">{{ t('Still owed', 'Pendiente de pago') }}</th>
              <th class="px-3 py-2">{{ t('Shared with', 'Compartido con') }}</th>
              <th class="px-3 py-2">{{ t('Will insert', 'Se insertará') }}</th>
              <th class="px-3 py-2">{{ t('Status', 'Estado') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in candidates" :key="c.phPackageId" class="border-t border-line">
              <td class="px-3 py-2">{{ c.patientName }}</td>
              <td class="px-3 py-2">{{ c.packageName }}</td>
              <td class="px-3 py-2">{{ c.visitsLeft }}/{{ c.visits }}</td>
              <td class="px-3 py-2">{{ c.price }}</td>
              <td class="px-3 py-2">{{ c.balance }}</td>
              <td class="px-3 py-2">{{ c.owing }}</td>
              <td class="px-3 py-2">{{ c.packageBalance }}</td>
              <td class="px-3 py-2" :class="c.owedCents > 0 ? 'font-medium text-warning-text' : 'text-ink-muted2'">
                <template v-if="c.owedCents > 0">€{{ formatEuros(c.owedCents) }}</template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2 text-ink-muted2">
                <template v-if="c.sharedWith.length > 0">{{ c.sharedWith.map((m) => m.name).join(', ') }}</template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2">
                <div v-if="!c.repairOnly">€{{ formatEuros(c.priceCents) }} {{ t('bono', 'bono') }}</div>
                <div v-if="c.counterSync" class="text-warning-text">
                  <template v-if="c.counterSync.sessionsUsed !== undefined">{{ t('used', 'usadas') }} &rarr; {{ c.counterSync.sessionsUsed }}<br /></template>
                  <template v-if="c.counterSync.sessionsTotal !== undefined">{{ t('of', 'de') }} &rarr; {{ c.counterSync.sessionsTotal }}<br /></template>
                  <template v-if="c.counterSync.priceCents !== undefined">€{{ formatEuros(c.counterSync.priceCents) }} {{ t('price', 'precio') }}</template>
                </div>
                <div v-if="c.usedAheadOfPracticeHub" class="text-ink-muted2">{{ t('more used here than in PracticeHub -- not changed', 'más usadas aquí que en PracticeHub: sin cambios') }}</div>
                <div v-if="c.owedCents > 0" class="text-ink-muted2">€{{ formatEuros(c.owedCents) }} {{ t('still owed on it', 'pendiente en el bono') }}</div>
                <div v-if="c.needsReferenceStamp" class="text-ink-muted2">{{ t('+ PracticeHub reference', '+ referencia de PracticeHub') }}</div>
              </td>
              <td class="px-3 py-2">
                <span v-if="c.status === 'pending' && c.repairOnly && c.counterSync" class="text-warning-text">{{ t('Out of date', 'Desactualizado') }}</span>
                <span v-else-if="c.status === 'pending' && c.repairOnly && c.sharedWith.length > 0" class="text-warning-text">{{ t('Missing shared patients', 'Faltan pacientes compartidos') }}</span>
                <span v-else-if="c.status === 'pending' && c.repairOnly" class="text-ink-muted2">{{ t('Missing reference', 'Falta la referencia') }}</span>
                <span v-else-if="c.status === 'pending'" class="text-ink-600">{{ t('Pending', 'Pendiente') }}</span>
                <span v-else-if="c.status === 'applied'" class="text-ink-muted2">{{ t('Applied', 'Aplicado') }}</span>
                <span v-else class="text-danger-text">{{ c.errorMessage || t('Error', 'Error') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          :disabled="candidates.filter((c) => c.status === 'pending').length === 0 && duplicateMerges.length === 0"
          @click="applyFixes"
        >
          <template v-if="duplicateMerges.length > 0">
            {{
              t(
                `Apply ${candidates.filter((c) => c.status === 'pending').length} fix(es) and merge ${duplicateMerges.length} duplicate(s)`,
                `Aplicar ${candidates.filter((c) => c.status === 'pending').length} corrección(es) y fusionar ${duplicateMerges.length} duplicado(s)`,
              )
            }}
          </template>
          <template v-else>
            {{ t(`Apply ${candidates.filter((c) => c.status === 'pending').length} fix(es)`, `Aplicar ${candidates.filter((c) => c.status === 'pending').length} corrección(es)`) }}
          </template>
        </button>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Cancel', 'Cancelar') }}
        </button>
      </div>
    </div>

    <div v-else-if="stage === 'applying'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ t('Applying fixes…', 'Aplicando correcciones…') }}</p>
      <p class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div v-if="mergeError" class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Merging duplicates stopped:', 'La fusión de duplicados se detuvo:') }}</p>
        <p class="mt-1">{{ mergeError }}</p>
        <p class="mt-1">
          {{ t('The remaining duplicates were left alone. Run this again to retry them.', 'Los duplicados restantes no se tocaron. Vuelve a ejecutar esto para reintentarlos.') }}
        </p>
      </div>
      <div v-if="candidates.some((c) => c.status === 'error')" class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Some rows failed:', 'Algunas filas fallaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="c in candidates.filter((c) => c.status === 'error')" :key="c.phPackageId">{{ c.patientName }} — {{ c.errorMessage }}</li>
        </ul>
      </div>
      <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
        {{ t('Run again', 'Ejecutar de nuevo') }}
      </button>
    </div>
  </div>
</template>
