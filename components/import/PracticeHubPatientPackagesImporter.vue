<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface PHPatient { id: number; patient_number: string }
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
  // What this bono's credit should be: paid minus consumed.
  targetCreditCents: number
  // What it carries today, from the bono's own credit rows.
  attributedCreditCents: number
  // target - attributed. Negative takes back an over-credit.
  creditDeltaCents: number
  // What the patient still owes on this bono, from PracticeHub's own
  // `package_balance`. Raised as an unpaid invoice so the debt shows in
  // reports instead of being implied by a PracticeHub column nobody reads.
  owedCents: number
  needsInvoice: boolean
  // True for a package already in package_purchases: applying it adds only
  // the missing credit and/or invoice, leaving the purchase record alone.
  creditOnly: boolean
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
  // The patient's whole credit balance today, shown so a package repaired
  // by hand earlier isn't credited a second time here.
  currentCreditCents: number
  status: 'pending' | 'applied' | 'error'
  errorMessage?: string
}

const stage = ref<'connect' | 'loading' | 'preview' | 'applying' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const candidates = ref<Candidate[]>([])
const skippedUnmatched = ref(0)
const skippedNoValue = ref(0)
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
// actually paid 301) PH under-reports what was paid, so this under-credits.
// It never over-credits, which is the safer direction, and the reconciliation
// report is where those show up.
function creditCentsFor(pkg: PHPatientPackage): number {
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
// having linked the payment (see the caveat on creditCentsFor) than a debt
// this clinic is still owed, and inventing receivables against old patients
// is the one mistake here that reaches the outside world.
function owedCentsFor(pkg: PHPatientPackage): number {
  return Math.max(0, Math.round(-(pkg.package_balance ?? 0) * 100))
}

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'loading'
  runError.value = ''
  candidates.value = []
  skippedUnmatched.value = 0
  skippedNoValue.value = 0
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const phPatients = await api.fetchAll<PHPatient>('/patients', (done, total) => (progress.value = { done, total }))
    const patientNumberById = new Map(phPatients.map((p) => [String(p.id), p.patient_number]))

    const PAGE_SIZE = 1000
    const ourPatientByRef = new Map<string, { id: string; name: string }>()
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('patients').select('id, external_reference, first_name, last_name').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const p of data ?? []) if (p.external_reference) ourPatientByRef.set(p.external_reference, { id: p.id, name: `${p.first_name} ${p.last_name}` })
      if (!data || data.length < PAGE_SIZE) break
    }

    // Our own bono rows, indexed two ways. `external_reference` is the exact
    // key for anything this importer created, but the 178 bonos backfilled by
    // hand before it existed have none -- for those, same patient plus same
    // purchase day is the key, and it resolves all 178 of them with nothing
    // left over.
    phase.value = t('Checking for already-imported packages…', 'Comprobando bonos ya importados…')
    const purchaseByRef = new Map<string, string>()
    // A LIST per day, not a single id. Two PracticeHub bonos created on the
    // same day for the same patient used to both resolve to the same local
    // row, and each then took back the same deposit: Oscar Inga's two bonos
    // both claimed his one 360 EUR row and clawed it back twice, leaving him
    // at -280 EUR. Each local row is now claimed by at most one bono, and a
    // bono that finds nothing left to claim is a genuinely new one to insert.
    const purchasesByPatientDay = new Map<string, string[]>()
    // A bono already pointing at an invoice is not billed again, whatever
    // that invoice is numbered -- one raised by an earlier run, one from a
    // sale through the app, or one created by hand during a repair.
    const purchaseHasInvoice = new Set<string>()
    // Rows carrying no PracticeHub reference: the bonos the hand backfill
    // created. The importer recognises them by patient and day, but never
    // wrote the reference onto them, so nothing downstream can see they are
    // the same bono -- the migration check counts by reference and reported
    // 188 of them as missing from a set that is entirely present.
    const purchaseNeedsReference = new Set<string>()
    // Bonos that already have their household members attached, so a re-run
    // does not add the same person to the same bono twice.
    const purchaseHasShares = new Set<string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_purchases').select('id, patient_id, purchased_at, external_reference, invoice_id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) {
        if (row.external_reference) purchaseByRef.set(row.external_reference, row.id)
        const dayKey = `${row.patient_id}|${String(row.purchased_at).slice(0, 10)}`
        const sameDay = purchasesByPatientDay.get(dayKey)
        if (sameDay) sameDay.push(row.id)
        else purchasesByPatientDay.set(dayKey, [row.id])
        if (row.invoice_id) purchaseHasInvoice.add(row.id)
        if (!row.external_reference) purchaseNeedsReference.add(row.id)
      }
      if (!data || data.length < PAGE_SIZE) break
    }

    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_purchase_shares').select('package_purchase_id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) purchaseHasShares.add(row.package_purchase_id)
      if (!data || data.length < PAGE_SIZE) break
    }

    // Invoices this importer raised on an earlier run. `invoices` has no
    // external_reference column, so the bono's own reference is used as the
    // invoice number -- distinct from the payments importer's `PH-{payment}`
    // numbering, and enough to keep a re-run from billing the same debt twice
    // even if a previous run died between the insert and the purchase link.
    phase.value = t('Checking existing bono invoices…', 'Comprobando facturas de bonos existentes…')
    const invoicedExternalRefs = new Set<string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('invoices')
        .select('invoice_number')
        .like('invoice_number', 'PH-package-%')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) if (row.invoice_number) invoicedExternalRefs.add(row.invoice_number)
      if (!data || data.length < PAGE_SIZE) break
    }

    // How much credit each bono is already carrying, so a re-run corrects it
    // to the right figure instead of piling another deposit on top.
    //
    // Two ways in, matching the two ways a bono is identified above: credit
    // this importer wrote carries the bono's reference, and credit from the
    // hand backfill carries none but was backdated to the purchase day. Only
    // positive rows are counted on the day key -- a negative row is a session
    // drawn down later, which is real consumption and must survive the
    // correction rather than be treated as credit that was never deposited.
    phase.value = t('Checking existing credit…', 'Comprobando el crédito existente…')
    const creditCentsByRef = new Map<string, number>()
    const depositCentsByPatientDay = new Map<string, number>()
    const creditCentsByPatient = new Map<string, number>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('account_credits')
        .select('patient_id, amount_cents, external_reference, created_at')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) {
        creditCentsByPatient.set(row.patient_id, (creditCentsByPatient.get(row.patient_id) ?? 0) + row.amount_cents)
        if (row.external_reference) {
          creditCentsByRef.set(row.external_reference, (creditCentsByRef.get(row.external_reference) ?? 0) + row.amount_cents)
        } else if (row.amount_cents > 0) {
          const key = `${row.patient_id}|${String(row.created_at).slice(0, 10)}`
          depositCentsByPatientDay.set(key, (depositCentsByPatientDay.get(key) ?? 0) + row.amount_cents)
        }
      }
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Fetching patient packages…', 'Obteniendo bonos de pacientes…')
    progress.value = { done: 0, total: 0 }
    const phPackages = await api.fetchAll<PHPatientPackage>('/patient_packages', (done, total) => (progress.value = { done, total }))
    rawSample.value = phPackages.slice(0, 3)

    const built: Candidate[] = []
    // Credit each patient will hold as the preview is built up, so a second
    // bono for the same patient corrects against the first one's effect.
    const runningCreditByPatient = new Map<string, number>()
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
    const groupTargetCents = new Map<string, number>()
    const groupAttributedCents = new Map<string, number>()
    const groupLeadPackageId = new Map<string, number>()
    const groupFallbackLeadPackageId = new Map<string, number>()
    for (const pkg of sortedPackages) {
      const phId = patientIdOf(pkg)
      const number = phId !== null ? patientNumberById.get(String(phId)) : undefined
      const patient = number ? ourPatientByRef.get(number) : undefined
      if (!patient) continue
      const key = `${patient.id}|${pkg.created.slice(0, 10)}`
      const ref = `PH-package-${pkg.id}`
      groupTargetCents.set(key, (groupTargetCents.get(key) ?? 0) + (pkg.active === 1 ? creditCentsFor(pkg) : 0))
      groupAttributedCents.set(
        key,
        (groupAttributedCents.get(key) ?? 0) + (creditCentsByRef.get(ref) ?? 0) + (creditCentsByRef.get(`${ref}-adjustment`) ?? 0),
      )
      // Prefer a lead the main loop will actually reach. A spent bono with
      // nothing owed is skipped below, and a skipped lead would take its whole
      // day's correction with it; the fallback covers a day where every bono
      // is spent but a deposit is still sitting against it, which is an
      // over-credit that has to be clawed back like any other.
      const leadable = pkg.active !== 1 || (pkg.visits_left ?? 0) > 0 || (pkg.balance ?? 0) > 0 || owedCentsFor(pkg) > 0
      if (leadable) {
        if (!groupLeadPackageId.has(key)) groupLeadPackageId.set(key, pkg.id)
      } else if (!groupFallbackLeadPackageId.has(key)) {
        groupFallbackLeadPackageId.set(key, pkg.id)
      }
    }
    for (const [key, id] of groupFallbackLeadPackageId) if (!groupLeadPackageId.has(key)) groupLeadPackageId.set(key, id)
    // The day's backfilled deposit belongs to the day, so it is added once.
    for (const key of groupTargetCents.keys()) {
      groupAttributedCents.set(key, (groupAttributedCents.get(key) ?? 0) + (depositCentsByPatientDay.get(key) ?? 0))
    }

    for (const pkg of sortedPackages) {
      const externalRef = `PH-package-${pkg.id}`
      const adjustmentRef = `${externalRef}-adjustment`
      const alreadyInvoiced = invoicedExternalRefs.has(externalRef)

      // Closed packages are imported too, as history. Skipping them is what
      // left a patient's Billing tab showing a course of visits with nothing
      // that paid for them: a spent bono is deactivated in PracticeHub, so
      // every fully-used course was being dropped. They come in with no
      // credit attached (see below), so they add the record without moving
      // anyone's balance.
      const isActive = pkg.active === 1

      const phPatientId = patientIdOf(pkg)
      const patientNumber = phPatientId !== null ? patientNumberById.get(String(phPatientId)) : undefined
      const ourPatient = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
      if (!ourPatient) {
        skippedUnmatched.value++
        continue
      }

      // Resolve the household members sharing this bono to our own patients.
      // Anyone PracticeHub knows and we do not is counted as unmatched rather
      // than silently dropped.
      const sharedWith: { id: string; name: string }[] = []
      for (const sharedPhId of sharedPatientIdsOf(pkg, phPatientId)) {
        const sharedNumber = patientNumberById.get(String(sharedPhId))
        const sharedPatient = sharedNumber ? ourPatientByRef.get(sharedNumber) : undefined
        if (sharedPatient) sharedWith.push(sharedPatient)
        else skippedUnmatched.value++
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

      // Only meaningful for a live package -- a closed one having no value
      // left is the normal case, not a reason to skip it. Owing money counts
      // as something left to do even with no visits left: a bono used to the
      // last session that was never paid off is exactly the debt this is meant
      // to surface, and dropping it here would silently forgive it. Nor is a
      // bono dropped while it is the one carrying its day's credit correction.
      if (isActive) {
        // Household members count as something left to record even on a bono
        // with no visits and nothing owed: the share is how the rest of the
        // family reaches it, and skipping the bono skips them with it.
        const hasRemainingValue =
          (pkg.visits_left ?? 0) > 0 || (pkg.balance ?? 0) > 0 || owedCentsFor(pkg) > 0 || sharedPatientIdsOf(pkg, phPatientId).length > 0
        const carriesDayCorrection =
          groupLeadPackageId.get(dayKey) === pkg.id && (groupTargetCents.get(dayKey) ?? 0) !== (groupAttributedCents.get(dayKey) ?? 0)
        if (!hasRemainingValue && !carriesDayCorrection) {
          skippedNoValue.value++
          continue
        }
      }

      let existingPurchaseId = purchaseByRef.get(externalRef) ?? null
      if (existingPurchaseId === null) existingPurchaseId = purchasesByPatientDay.get(dayKey)?.shift() ?? null

      const visitsTotal = pkg.visits ?? pkg.visits_left ?? 0
      const visitsLeft = pkg.visits_left ?? visitsTotal
      const sessionsUsed = Math.max(0, visitsTotal - visitsLeft)
      // A deactivated package is closed: whatever visits it had left are no
      // longer claimable, so it carries no credit. Granting one would invent
      // money the clinic never owed.
      const targetCreditCents = isActive ? creditCentsFor(pkg) : 0
      const owedCents = isActive ? owedCentsFor(pkg) : 0
      const needsInvoice = owedCents > 0 && !alreadyInvoiced && !(existingPurchaseId !== null && purchaseHasInvoice.has(existingPurchaseId))

      // What this bono already carries. Credit written against the bono's own
      // reference is exact; otherwise fall back to the deposits backdated to
      // its purchase day, which is what the hand backfill left behind. Never
      // both: a bono with its own reference has already been accounted for,
      // and adding the day figure on top would double-count it.
      // Everything this bono already carries, added up -- never one source
      // instead of another. These are three different rows that can all exist
      // at once for the same bono, and reading only one of them is what stopped
      // the tool converging: a corrected backfill bono has a `-adjustment` row
      // but no row under its plain reference, so the `has(reference)` test that
      // used to pick between the branches failed, the original deposit was read
      // on its own, and the correction sitting next to it was ignored. Every
      // re-run then proposed the same claw-back again. It never double-charged
      // anyone -- the unique index on (account_id, external_reference) refuses
      // the second write -- but the front desk was shown 117 fixes that were
      // all already applied.
      //
      //   deposit  +360   backfilled, no reference, backdated to the purchase
      //   adjust   -360   the correction this tool wrote
      //   -------------
      //   carries     0   which is the target, so there is nothing left to do
      //
      // The deposit is still consumed on read, so a second bono on the same day
      // starts from zero instead of taking the same money back again.
      // The day's whole correction rides on its first bono; the others carry
      // no credit row, so they show nothing to reconcile.
      const isGroupLead = groupLeadPackageId.get(dayKey) === pkg.id
      const attributedCreditCents = isGroupLead ? groupAttributedCents.get(dayKey) ?? 0 : 0

      // The correction. Positive tops a bono up to what was paid, negative
      // takes back credit the old full-entitlement rule handed over: 178
      // bonos were backfilled at the value of the sessions remaining rather
      // than the money received, so every part-payer among them is holding
      // credit for sessions nobody has paid for yet.
      let creditDeltaCents = isGroupLead ? (groupTargetCents.get(dayKey) ?? 0) - attributedCreditCents : 0

      // Backstop, independent of the matching above: a patient cannot hold
      // negative credit. Whatever they owe is an invoice, never a negative
      // balance, so a claw-back is capped at what they actually hold. If the
      // matching is ever wrong again this bounds the damage to "no credit"
      // instead of a debt invented in the ledger, and running per patient
      // means two bonos correcting the same patient in one pass see each
      // other's effect rather than both measuring from the starting figure.
      const patientCreditNow = runningCreditByPatient.get(ourPatient.id) ?? creditCentsByPatient.get(ourPatient.id) ?? 0
      if (creditDeltaCents < 0 && patientCreditNow + creditDeltaCents < 0) creditDeltaCents = -patientCreditNow
      runningCreditByPatient.set(ourPatient.id, patientCreditNow + creditDeltaCents)

      // Nothing left to do: the credit is already right and either the bono
      // is settled or its debt is on an invoice.
      const needsShares = sharedWith.length > 0 && !(existingPurchaseId !== null && purchaseHasShares.has(existingPurchaseId))
      const needsReferenceStamp = existingPurchaseId !== null && purchaseNeedsReference.has(existingPurchaseId)
      if (existingPurchaseId && creditDeltaCents === 0 && !needsInvoice && !needsShares && !needsReferenceStamp) continue

      built.push({
        phPackageId: pkg.id,
        patientId: ourPatient.id,
        patientName: ourPatient.name,
        packageName: pkg.name || pkg.package_type || 'Package',
        visits: pkg.visits,
        visitsLeft: pkg.visits_left,
        price: pkg.price,
        balance: pkg.balance,
        owing: pkg.owing,
        packageBalance: pkg.package_balance,
        created: pkg.created,
        sessionsTotal: Math.max(visitsTotal, 1),
        sessionsUsed,
        priceCents: Math.round((pkg.price ?? 0) * 100),
        isActive,
        targetCreditCents,
        attributedCreditCents,
        creditDeltaCents,
        owedCents,
        needsInvoice,
        creditOnly: existingPurchaseId !== null,
        existingPurchaseId,
        needsReferenceStamp,
        sharedWith,
        currentCreditCents: creditCentsByPatient.get(ourPatient.id) ?? 0,
        status: 'pending',
      })
    }

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

  for (const c of toApply) {
    const externalRef = `PH-package-${c.phPackageId}`
    let purchaseId = c.existingPurchaseId

    // A repair leaves the existing purchase row untouched and only adds the
    // credit and invoice it never got.
    if (!c.creditOnly) {
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

    if (c.creditDeltaCents !== 0) {
      // A first deposit carries the bono's reference; a later correction
      // carries `-adjustment` so the two can be told apart and so a re-run
      // reads its own correction back rather than applying it twice. The
      // original row is left untouched -- the ledger shows what was deposited
      // and what was taken back, not a number quietly rewritten.
      const isCorrection = c.attributedCreditCents !== 0
      const { error: creditError } = await supabase.from('account_credits').insert({
        account_id: store.accountId!,
        patient_id: c.patientId,
        amount_cents: c.creditDeltaCents,
        reason: isCorrection
          ? `${c.packageName} (corrected to what was paid: €${formatEuros(c.targetCreditCents)}, was €${formatEuros(c.attributedCreditCents)})`
          : `${c.packageName} (migrated from PracticeHub -- ${c.visitsLeft ?? '?'}/${c.visits ?? '?'} sessions remaining)`,
        external_reference: isCorrection ? `${externalRef}-adjustment` : externalRef,
        created_at: isCorrection ? new Date().toISOString() : c.created,
      })
      if (creditError) {
        c.status = 'error'
        c.errorMessage = creditError.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
    }

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

    // The outstanding half of a part-paid bono, raised as an unpaid invoice
    // so it reads as money owed rather than living only in a PracticeHub
    // column. No payment row is written: what was already paid came over
    // with the payments importer and is counted there.
    if (c.needsInvoice) {
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          account_id: store.accountId!,
          patient_id: c.patientId,
          invoice_number: externalRef,
          status: 'unpaid',
          total_cents: c.owedCents,
          created_at: c.created,
        })
        .select('id')
        .single()

      if (invoiceError || !invoice) {
        c.status = 'error'
        c.errorMessage = invoiceError?.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }

      const paidCents = Math.max(0, c.priceCents - c.owedCents)
      await supabase.from('invoice_line_items').insert({
        account_id: store.accountId!,
        invoice_id: invoice.id,
        description: `${c.packageName} -- outstanding balance from PracticeHub (€${formatEuros(paidCents)} of €${formatEuros(c.priceCents)} already paid)`,
        quantity: 1,
        price_cents: c.owedCents,
      })

      // Pointing the purchase at the invoice is what makes the Billing tab's
      // owed figure light up for this bono. `is('invoice_id', null)` so a
      // bono already linked to an invoice -- one sold through the app, or
      // relinked by hand -- keeps the link it has.
      if (purchaseId) await supabase.from('package_purchases').update({ invoice_id: invoice.id }).eq('id', purchaseId).is('invoice_id', null)
    }

    c.status = 'applied'
    progress.value = { done: progress.value.done + 1, total: toApply.length }
  }

  stage.value = 'done'
  showToast(
    t(
      `Applied ${candidates.value.filter((c) => c.status === 'applied').length} fix(es).`,
      `Se aplicaron ${candidates.value.filter((c) => c.status === 'applied').length} corrección(es).`,
    ),
    candidates.value.some((c) => c.status === 'error') ? 'error' : 'success',
  )
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  candidates.value = []
  skippedUnmatched.value = 0
  skippedNoValue.value = 0
  progress.value = { done: 0, total: 0 }
}

function formatEuros(cents: number): string {
  return (cents / 100).toFixed(2)
}
</script>

<template>
  <div>
    <p class="text-[13px] text-ink-muted2">
      {{ t('Copies bonos from PracticeHub, and repairs ones imported earlier: the credit they never got, and an invoice for whatever is still owed on them.', 'Copia los bonos desde PracticeHub y repara los importados antes: el saldo que nunca recibieron y una factura por lo que queda pendiente de pago.') }}
    </p>

    <div class="mt-3 space-y-2">
      <div class="flex gap-2.5 rounded-ctl border border-line-divider bg-surface-subtle p-3">
        <span class="mt-0.5 shrink-0 text-[13px]">👁</span>
        <p class="text-[12.5px] leading-relaxed text-ink-600">
          <span class="font-medium text-ink-700">{{ t('Nothing is written until you press Apply.', 'No se escribe nada hasta que pulses Aplicar.') }}</span>
          {{ t('The preview shows PracticeHub\'s own price / balance / owing / package_balance columns so you can check them against a patient you already know before trusting the rest.', 'La vista previa muestra las columnas price / balance / owing / package_balance de PracticeHub para que las compruebes con un paciente que ya conozcas antes de fiarte del resto.') }}
        </p>
      </div>

      <div class="flex gap-2.5 rounded-ctl border border-line-divider bg-surface-subtle p-3">
        <span class="mt-0.5 shrink-0 text-[13px]">🧮</span>
        <p class="text-[12.5px] leading-relaxed text-ink-600">
          <span class="font-medium text-ink-700">{{ t('Credit is what they paid, minus what they used.', 'El saldo es lo que pagaron, menos lo que consumieron.') }}</span>
          {{ t('It is not the value of the sessions they still have left. A half-paid bono can still be used in full \u2014 the unpaid part is money owed on the invoice, not credit on the account. The preview computes it as balance + package_balance.', 'No es el valor de las sesiones que les quedan. Un bono pagado a medias se puede usar entero: la parte no pagada es dinero pendiente en la factura, no saldo en la cuenta. La vista previa lo calcula como balance + package_balance.') }}
        </p>
      </div>

      <div class="flex gap-2.5 rounded-ctl border border-line-divider bg-surface-subtle p-3">
        <span class="mt-0.5 shrink-0 text-[13px]">🧾</span>
        <p class="text-[12.5px] leading-relaxed text-ink-600">
          <span class="font-medium text-ink-700">{{ t('What is still owed becomes an unpaid invoice.', 'Lo que queda por pagar se convierte en una factura pendiente.') }}</span>
          {{ t('Only the outstanding part is billed \u2014 the half already paid came over with the payments importer, so invoicing the full price again would double the clinic\u0027s takings. No payment is recorded here, and only active bonos are billed.', 'Sólo se factura la parte pendiente: la parte ya pagada vino con el importador de pagos, así que volver a facturar el precio completo duplicaría los ingresos de la clínica. Aquí no se registra ningún pago, y sólo se facturan los bonos activos.') }}
        </p>
      </div>

      <div class="flex gap-2.5 rounded-ctl border border-warning-border bg-warning-bg p-3">
        <span class="mt-0.5 shrink-0 text-[13px]">⚠️</span>
        <p class="text-[12.5px] leading-relaxed text-warning-text">
          <span class="font-medium">{{ t('This corrects credit that is already wrong, up or down.', 'Esto corrige saldos que ya est\u00e1n mal, al alza o a la baja.') }}</span>
          {{ t('178 bonos were credited with the value of the sessions remaining instead of the money received, so every part-payer among them holds credit for sessions nobody has paid for. Read the "Should be" column against "Credit now" before applying. Nothing is overwritten \u2014 a correction is added as its own ledger row.', 'Se abonaron 178 bonos con el valor de las sesiones restantes en lugar del dinero recibido, as\u00ed que quien pag\u00f3 a medias tiene saldo por sesiones que nadie ha pagado. Compara la columna \u00abDeber\u00eda ser\u00bb con \u00abSaldo actual\u00bb antes de aplicar. No se sobrescribe nada: la correcci\u00f3n se a\u00f1ade como su propia l\u00ednea del libro.') }}
        </p>
      </div>

      <div class="flex gap-2.5 rounded-ctl border border-line-divider bg-surface-subtle p-3">
        <span class="mt-0.5 shrink-0 text-[13px]">🔁</span>
        <p class="text-[12.5px] leading-relaxed text-ink-600">
          <span class="font-medium text-ink-700">{{ t('Safe to run again.', 'Se puede volver a ejecutar.') }}</span>
          {{ t('Bonos that are already imported, already credited and already invoiced are skipped, as are ones matching a bono added by hand on the same day. The invoice is numbered after the bono, so a debt is never billed twice.', 'Se omiten los bonos ya importados, ya abonados y ya facturados, igual que los que coinciden con un bono a\u00f1adido a mano el mismo d\u00eda. La factura lleva el n\u00famero del bono, as\u00ed que una deuda nunca se factura dos veces.') }}
        </p>
      </div>
    </div>

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
            `Found ${candidates.filter((c) => c.status === 'pending' && !c.creditOnly).length} new bono(s) to add and ${candidates.filter((c) => c.status === 'pending' && c.creditOnly).length} already here that need correcting. Credit going up on ${candidates.filter((c) => c.creditDeltaCents > 0).length}: +€${formatEuros(candidates.filter((c) => c.creditDeltaCents > 0).reduce((sum, c) => sum + c.creditDeltaCents, 0))}. Credit coming back on ${candidates.filter((c) => c.creditDeltaCents < 0).length} over-credited by the old full-entitlement rule: -€${formatEuros(-candidates.filter((c) => c.creditDeltaCents < 0).reduce((sum, c) => sum + c.creditDeltaCents, 0))}. Invoices for money still owed: ${candidates.filter((c) => c.needsInvoice).length}, €${formatEuros(candidates.filter((c) => c.needsInvoice).reduce((sum, c) => sum + c.owedCents, 0))}. Skipped: ${skippedUnmatched} unmatched patients, ${skippedNoValue} active bonos with nothing left on them.`,
            `Se encontraron ${candidates.filter((c) => c.status === 'pending' && !c.creditOnly).length} bono(s) nuevos y ${candidates.filter((c) => c.status === 'pending' && c.creditOnly).length} ya existentes que hay que corregir. Sube el saldo en ${candidates.filter((c) => c.creditDeltaCents > 0).length}: +€${formatEuros(candidates.filter((c) => c.creditDeltaCents > 0).reduce((sum, c) => sum + c.creditDeltaCents, 0))}. Se retira saldo en ${candidates.filter((c) => c.creditDeltaCents < 0).length} con saldo de más por la regla antigua: -€${formatEuros(-candidates.filter((c) => c.creditDeltaCents < 0).reduce((sum, c) => sum + c.creditDeltaCents, 0))}. Facturas por lo que queda pendiente: ${candidates.filter((c) => c.needsInvoice).length}, €${formatEuros(candidates.filter((c) => c.needsInvoice).reduce((sum, c) => sum + c.owedCents, 0))}. Omitidos: ${skippedUnmatched} pacientes sin emparejar, ${skippedNoValue} bonos activos sin saldo restante.`,
          )
        }}
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
              <th class="px-3 py-2">{{ t('Credit now', 'Saldo actual') }}</th>
              <th class="px-3 py-2">{{ t('Should be', 'Debería ser') }}</th>
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
              <td class="px-3 py-2">€{{ formatEuros(c.attributedCreditCents) }}</td>
              <td class="px-3 py-2" :class="c.creditDeltaCents !== 0 ? 'font-medium text-warning-text' : 'text-ink-muted2'">€{{ formatEuros(c.targetCreditCents) }}</td>
              <td class="px-3 py-2" :class="c.owedCents > 0 ? 'font-medium text-warning-text' : 'text-ink-muted2'">
                <template v-if="c.owedCents > 0">€{{ formatEuros(c.owedCents) }}</template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2 text-ink-muted2">
                <template v-if="c.sharedWith.length > 0">{{ c.sharedWith.map((m) => m.name).join(', ') }}</template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2">
                <div v-if="!c.creditOnly">€{{ formatEuros(c.priceCents) }} {{ t('bono', 'bono') }}</div>
                <div v-if="c.creditDeltaCents !== 0" :class="c.creditDeltaCents < 0 ? 'text-danger-text' : ''">
                  {{ c.creditDeltaCents > 0 ? '+' : '' }}€{{ formatEuros(c.creditDeltaCents) }} {{ t('credit', 'crédito') }}
                </div>
                <div v-if="c.needsInvoice" class="text-warning-text">+ €{{ formatEuros(c.owedCents) }} {{ t('invoice', 'factura') }}</div>
                <div v-if="c.needsReferenceStamp" class="text-ink-muted2">{{ t('+ PracticeHub reference', '+ referencia de PracticeHub') }}</div>
              </td>
              <td class="px-3 py-2">
                <span v-if="c.status === 'pending' && c.creditDeltaCents < 0" class="text-danger-text">{{ t('Over-credited', 'Saldo de más') }}</span>
                <span v-else-if="c.status === 'pending' && c.creditOnly && c.creditDeltaCents === 0 && c.needsInvoice" class="text-warning-text">{{ t('Missing invoice', 'Falta la factura') }}</span>
                <span v-else-if="c.status === 'pending' && c.creditOnly && c.creditDeltaCents === 0 && c.sharedWith.length > 0" class="text-warning-text">{{ t('Missing shared patients', 'Faltan pacientes compartidos') }}</span>
                <span v-else-if="c.status === 'pending' && c.creditOnly && c.creditDeltaCents === 0" class="text-ink-muted2">{{ t('Missing reference', 'Falta la referencia') }}</span>
                <span v-else-if="c.status === 'pending' && c.creditOnly" class="text-warning-text">{{ t('Missing credit', 'Falta el saldo') }}</span>
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
          :disabled="candidates.filter((c) => c.status === 'pending').length === 0"
          @click="applyFixes"
        >
          {{ t(`Apply ${candidates.filter((c) => c.status === 'pending').length} fix(es)`, `Aplicar ${candidates.filter((c) => c.status === 'pending').length} corrección(es)`) }}
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
