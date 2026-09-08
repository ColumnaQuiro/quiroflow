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
  creditCents: number
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
  // The patient's whole credit balance today, shown so a package repaired
  // by hand earlier isn't credited a second time here.
  currentCreditCents: number
  status: 'pending' | 'applied' | 'skipped-existing' | 'error'
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

    phase.value = t('Checking for already-imported packages…', 'Comprobando bonos ya importados…')
    const existingExternalRefs = new Set<string>()
    // Keyed by external_reference so an already-imported bono can have the
    // invoice this raises pointed at its existing purchase row.
    const existingPurchaseById = new Map<string, string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('package_purchases')
        .select('id, external_reference')
        .not('external_reference', 'is', null)
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? [])
        if (row.external_reference) {
          existingExternalRefs.add(row.external_reference)
          existingPurchaseById.set(row.external_reference, row.id)
        }
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

    // Which packages already carry their credit, and what each patient holds
    // today. An earlier version of this importer read the credit from
    // `package_balance`/`owing` and wrote nothing when those came back 0 --
    // which is exactly what a fully paid-up bono reads -- so packages
    // imported back then exist with no credit against them and are skipped
    // on every re-run by the external_reference guard below. They are picked
    // up as credit-only repairs instead.
    phase.value = t('Checking existing credit…', 'Comprobando el crédito existente…')
    const creditedExternalRefs = new Set<string>()
    const creditCentsByPatient = new Map<string, number>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('account_credits')
        .select('patient_id, amount_cents, external_reference')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) {
        if (row.external_reference) creditedExternalRefs.add(row.external_reference)
        creditCentsByPatient.set(row.patient_id, (creditCentsByPatient.get(row.patient_id) ?? 0) + row.amount_cents)
      }
      if (!data || data.length < PAGE_SIZE) break
    }

    // Package fixes made by hand before this importer existed (Melanie,
    // David Poveda, Kenneth Davis, ...) have no external_reference to dedupe
    // against -- fall back to same-patient-same-day as a second guard so a
    // re-run doesn't double-credit someone already fixed manually.
    const existingByPatientDay = new Set<string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_purchases').select('patient_id, purchased_at').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) existingByPatientDay.add(`${row.patient_id}|${String(row.purchased_at).slice(0, 10)}`)
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Fetching patient packages…', 'Obteniendo bonos de pacientes…')
    progress.value = { done: 0, total: 0 }
    const phPackages = await api.fetchAll<PHPatientPackage>('/patient_packages', (done, total) => (progress.value = { done, total }))
    rawSample.value = phPackages.slice(0, 3)

    const built: Candidate[] = []
    for (const pkg of phPackages) {
      const externalRef = `PH-package-${pkg.id}`
      const alreadyImported = existingExternalRefs.has(externalRef)
      const alreadyCredited = creditedExternalRefs.has(externalRef)
      const alreadyInvoiced = invoicedExternalRefs.has(externalRef)

      // Closed packages are imported too, as history. Skipping them is what
      // left a patient's Billing tab showing a course of visits with nothing
      // that paid for them: a spent bono is deactivated in PracticeHub, so
      // every fully-used course was being dropped. They come in with no
      // credit attached (see below), so they add the record without moving
      // anyone's balance.
      const isActive = pkg.active === 1

      // Only meaningful for a live package -- a closed one having no value
      // left is the normal case, not a reason to skip it.
      if (isActive) {
        // Owing money counts as something left to do even with no visits
        // left: a bono used to the last session that was never paid off is
        // exactly the debt this is meant to surface, and dropping it here
        // would silently forgive it.
        const hasRemainingValue = (pkg.visits_left ?? 0) > 0 || (pkg.balance ?? 0) > 0 || owedCentsFor(pkg) > 0
        if (!hasRemainingValue) {
          skippedNoValue.value++
          continue
        }
      }

      const phPatientId = patientIdOf(pkg)
      const patientNumber = phPatientId !== null ? patientNumberById.get(String(phPatientId)) : undefined
      const ourPatient = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
      if (!ourPatient) {
        skippedUnmatched.value++
        continue
      }

      const dayKey = `${ourPatient.id}|${pkg.created.slice(0, 10)}`
      // The same-day guard exists to stop a re-run duplicating a hand-made
      // purchase record. It must not apply to a repair, where the matching
      // purchase row is precisely the one being credited.
      const alreadyHasSameDayPurchase = !alreadyImported && existingByPatientDay.has(dayKey)

      const visitsTotal = pkg.visits ?? pkg.visits_left ?? 0
      const visitsLeft = pkg.visits_left ?? visitsTotal
      const sessionsUsed = Math.max(0, visitsTotal - visitsLeft)
      // A deactivated package is closed: whatever visits it had left are no
      // longer claimable, so it carries no credit. Granting one would invent
      // money the clinic never owed.
      const creditCents = isActive && !alreadyCredited ? creditCentsFor(pkg) : 0
      const owedCents = isActive ? owedCentsFor(pkg) : 0
      const needsInvoice = owedCents > 0 && !alreadyInvoiced

      // Nothing left to do: the purchase row is there, its credit is there,
      // and either it is settled or its debt is already on an invoice. A
      // closed or spent package is correctly left uncredited and unbilled.
      if (alreadyImported && creditCents === 0 && !needsInvoice) continue

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
        creditCents,
        owedCents,
        needsInvoice,
        creditOnly: alreadyImported,
        existingPurchaseId: existingPurchaseById.get(externalRef) ?? null,
        currentCreditCents: creditCentsByPatient.get(ourPatient.id) ?? 0,
        status: alreadyHasSameDayPurchase ? 'skipped-existing' : 'pending',
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

    if (c.creditCents > 0) {
      const { error: creditError } = await supabase.from('account_credits').insert({
        account_id: store.accountId!,
        patient_id: c.patientId,
        amount_cents: c.creditCents,
        reason: `${c.packageName} (migrated from PracticeHub -- ${c.visitsLeft ?? '?'}/${c.visits ?? '?'} sessions remaining)`,
        external_reference: externalRef,
        created_at: c.created,
      })
      if (creditError) {
        c.status = 'error'
        c.errorMessage = creditError.message
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
          <span class="font-medium">{{ t('Check "Credit now" on every "Missing credit" row.', 'Revisa «Saldo actual» en cada fila «Falta el saldo».') }}</span>
          {{ t('Those add credit to a bono that already exists here. If the patient was fixed by hand before, that credit lands on top of what they already have.', 'Esas añaden saldo a un bono que ya existe aquí. Si el paciente se corrigió a mano antes, ese saldo se suma al que ya tiene.') }}
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
            `Found ${candidates.filter((c) => c.status === 'pending' && !c.creditOnly).length} package(s) to add -- ${candidates.filter((c) => c.status === 'pending' && !c.creditOnly && c.isActive).length} still active (these carry credit), ${candidates.filter((c) => c.status === 'pending' && !c.creditOnly && !c.isActive).length} closed (history only, no credit). Plus ${candidates.filter((c) => c.status === 'pending' && c.creditOnly).length} already-imported package(s) missing the credit an older version of this tool failed to write -- those add the credit only, leaving the purchase record as it is. Total credit to be granted: €${formatEuros(candidates.filter((c) => c.status === 'pending').reduce((sum, c) => sum + c.creditCents, 0))}. Skipped: ${candidates.filter((c) => c.status === 'skipped-existing').length} already covered by a same-day manual entry, ${skippedUnmatched} unmatched patients, ${skippedNoValue} active packages with nothing left on them.`,
            `Se encontraron ${candidates.filter((c) => c.status === 'pending' && !c.creditOnly).length} bono(s) para añadir -- ${candidates.filter((c) => c.status === 'pending' && !c.creditOnly && c.isActive).length} activos (con saldo), ${candidates.filter((c) => c.status === 'pending' && !c.creditOnly && !c.isActive).length} cerrados (solo histórico, sin saldo). Además ${candidates.filter((c) => c.status === 'pending' && c.creditOnly).length} bono(s) ya importados a los que falta el saldo que una versión anterior de esta herramienta no escribió -- en esos solo se añade el saldo, sin tocar el registro de compra. Saldo total a conceder: €${formatEuros(candidates.filter((c) => c.status === 'pending').reduce((sum, c) => sum + c.creditCents, 0))}. Omitidos: ${candidates.filter((c) => c.status === 'skipped-existing').length} ya cubiertos por una entrada manual del mismo día, ${skippedUnmatched} pacientes sin emparejar, ${skippedNoValue} bonos activos sin saldo restante.`,
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
              <th class="px-3 py-2">{{ t('Still owed', 'Pendiente de pago') }}</th>
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
              <td class="px-3 py-2" :class="c.creditOnly && c.currentCreditCents > 0 ? 'font-medium text-warning-text' : ''">€{{ formatEuros(c.currentCreditCents) }}</td>
              <td class="px-3 py-2" :class="c.owedCents > 0 ? 'font-medium text-warning-text' : 'text-ink-muted2'">
                <template v-if="c.owedCents > 0">€{{ formatEuros(c.owedCents) }}</template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2">
                <div v-if="c.creditOnly && c.creditCents > 0">€{{ formatEuros(c.creditCents) }} {{ t('credit only', 'solo crédito') }}</div>
                <div v-else-if="!c.creditOnly">€{{ formatEuros(c.priceCents) }} / €{{ formatEuros(c.creditCents) }} {{ t('credit', 'crédito') }}</div>
                <div v-if="c.needsInvoice" class="text-warning-text">+ €{{ formatEuros(c.owedCents) }} {{ t('invoice', 'factura') }}</div>
              </td>
              <td class="px-3 py-2">
                <span v-if="c.status === 'pending' && c.creditOnly && c.creditCents === 0" class="text-warning-text">{{ t('Missing invoice', 'Falta la factura') }}</span>
                <span v-else-if="c.status === 'pending' && c.creditOnly" class="text-warning-text">{{ t('Missing credit', 'Falta el saldo') }}</span>
                <span v-else-if="c.status === 'pending'" class="text-ink-600">{{ t('Pending', 'Pendiente') }}</span>
                <span v-else class="text-ink-muted2">{{ t('Already covered', 'Ya cubierto') }}</span>
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
