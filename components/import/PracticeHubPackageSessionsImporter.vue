<script setup lang="ts">
// Brings across the visits a patient took out of a bono while they were still
// on PracticeHub.
//
// QuiroFlow raises one invoice per payment, not per visit, and that is the
// right shape -- a bono is bought once and consumed over months, so an
// invoice per visit would double-count revenue the purchase already recorded.
// The side effect was that pre-migration bono visits landed nowhere: the
// Billing tab showed the bono purchase and then months of silence, with no
// sign of the ten visits that used it up.
//
// PracticeHub records them as an invoice per visit carrying an appointment_id
// and the per-session value (44 EUR on a 528 EUR / 12-visit bono). Those are
// imported here into package_sessions -- display-only rows, no debit, no
// credit, no effect on any balance.
//
// Identifying them: a PracticeHub invoice with no payment against that
// patient on that day was covered by something other than money changing
// hands, which for this clinic means a bono. Checked against the live
// account: of 6,946 invoices, 3,535 have no same-day payment, and their
// amounts cluster exactly on per-session bono rates -- 894 at 44 EUR, 808 at
// 46, 731 at 40, 699 at 43. Invoices that DO have a same-day payment are
// already represented in QuiroFlow as a payment-derived invoice and are
// skipped.
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface PHPatient { id: number; patient_number: string }
interface PHInvoice {
  id: number
  patient_id: number | null
  appointment_id: string | number | null
  total: string | number | null
  amount: string | number | null
  created: string
}
interface PHPayment { patient_id: number | null; amount: string | number | null; created: string }

// PracticeHub's field naming has been wrong twice before (see the packages
// importer), so the preview shows what the API actually returned rather than
// asking anyone to trust this mapping.
function totalOf(inv: PHInvoice): number {
  return Number(inv.total ?? inv.amount ?? 0)
}

interface Candidate {
  phInvoiceId: number
  patientId: string
  patientName: string
  amountCents: number
  usedAt: string
  appointmentId: string | null
  packagePurchaseId: string | null
  packageName: string | null
}

const stage = ref<'connect' | 'loading' | 'preview' | 'applying' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const candidates = ref<Candidate[]>([])
const skippedPaid = ref(0)
const skippedUnmatched = ref(0)
const appliedCount = ref(0)
const rawSample = ref<unknown[]>([])
const showRawSample = ref(false)
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const PAGE_SIZE = 1000
const dayOf = (d: string) => String(d).slice(0, 10)

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'loading'
  runError.value = ''
  skippedPaid.value = 0
  skippedUnmatched.value = 0
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Loading patients…', 'Cargando pacientes…')
    const phPatients = await api.fetchAll<PHPatient>('/patients', (done, total) => (progress.value = { done, total }))
    const patientNumberById = new Map(phPatients.map((p) => [String(p.id), String(p.patient_number)]))

    const ourPatientByRef = new Map<string, { id: string; name: string }>()
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('patients').select('id, external_reference, first_name, last_name').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data || data.length === 0) break
      for (const p of data) if (p.external_reference) ourPatientByRef.set(p.external_reference, { id: p.id, name: `${p.first_name} ${p.last_name ?? ''}`.trim() })
      if (data.length < PAGE_SIZE) break
    }

    // PracticeHub invoices carry the appointment they belong to; QuiroFlow
    // keeps that id in appointments.external_reference. Linking is
    // best-effort -- an unmatched invoice still records its value, it just
    // doesn't point at a calendar entry. The preview reports how many linked.
    const ourApptByRef = new Map<string, string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('appointments').select('id, external_reference').not('external_reference', 'is', null).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data || data.length === 0) break
      for (const a of data) if (a.external_reference) ourApptByRef.set(a.external_reference, a.id)
      if (data.length < PAGE_SIZE) break
    }

    // Every package a patient can draw from, so a visit can be attributed to
    // one. That is not only the packages they bought: a family bono is owned
    // by one member and drawn on by the whole household, so the other members
    // own nothing and their visits would be recorded with no bono at all --
    // Richard Klima's fourteen 40 EUR visits against Marlene's 1200 EUR / 30
    // Bono Familiar, which is 40 EUR a session. Already-imported invoices are
    // skipped on a re-run, so a visit stored without its bono stays that way;
    // the share has to be resolved on the first pass or not at all.
    type HeldPackage = { id: string; name: string; purchasedAt: string; rateCents: number | null }
    const purchasesByPatient = new Map<string, HeldPackage[]>()
    const packageById = new Map<string, HeldPackage>()
    const addHeld = (patientId: string, pkg: HeldPackage) => {
      const list = purchasesByPatient.get(patientId) ?? []
      list.push(pkg)
      purchasesByPatient.set(patientId, list)
    }
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_purchases').select('id, patient_id, package_name, purchased_at, price_cents, sessions_total').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data || data.length === 0) break
      for (const p of data) {
        const pkg: HeldPackage = {
          id: p.id,
          name: p.package_name,
          purchasedAt: String(p.purchased_at),
          // What one session off this bono costs. A 528 EUR / 12 bono is 44 a
          // session, and PracticeHub bills exactly that per visit, so the
          // invoice value identifies which bono the visit came out of.
          rateCents: p.sessions_total ? Math.round(p.price_cents / p.sessions_total) : null,
        }
        packageById.set(p.id, pkg)
        addHeld(p.patient_id, pkg)
      }
      if (data.length < PAGE_SIZE) break
    }
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_purchase_shares').select('package_purchase_id, patient_id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data || data.length === 0) break
      for (const share of data) {
        const pkg = share.package_purchase_id ? packageById.get(share.package_purchase_id) : undefined
        if (pkg && share.patient_id) addHeld(share.patient_id, pkg)
      }
      if (data.length < PAGE_SIZE) break
    }

    const existingRefs = new Set<string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_sessions').select('external_reference').not('external_reference', 'is', null).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (!data || data.length === 0) break
      for (const r of data) if (r.external_reference) existingRefs.add(r.external_reference)
      if (data.length < PAGE_SIZE) break
    }

    phase.value = t('Loading PracticeHub payments…', 'Cargando pagos de PracticeHub…')
    const phPayments = await api.fetchAll<PHPayment & { id: number }>('/payments', (done, total) => (progress.value = { done, total }))
    // Money available per patient per day, in cents, spent down as invoices
    // are matched against it. Two invoices on one day are both "paid" only if
    // that day's payments actually cover both. An invoice only partly covered
    // by cash counts as a bono visit for its full value -- rare enough not to
    // be worth splitting, and these rows carry no money either way.
    const purseByDay = new Map<string, number>()
    for (const p of phPayments) {
      const key = `${p.patient_id}|${dayOf(p.created)}`
      purseByDay.set(key, (purseByDay.get(key) ?? 0) + Math.round(Number(p.amount ?? 0) * 100))
    }

    phase.value = t('Loading PracticeHub invoices…', 'Cargando facturas de PracticeHub…')
    const phInvoices = await api.fetchAll<PHInvoice>('/invoices', (done, total) => (progress.value = { done, total }))
    rawSample.value = phInvoices.slice(0, 3)

    const built: Candidate[] = []
    // Oldest first, so a day's payments are consumed by that day's earliest
    // invoices rather than by whichever the API happened to return first.
    for (const inv of phInvoices.sort((a, b) => String(a.created).localeCompare(String(b.created)))) {
      const externalRef = `PH-invoice-${inv.id}`
      if (existingRefs.has(externalRef)) continue

      const totalCents = Math.round(totalOf(inv) * 100)
      if (totalCents <= 0) continue

      const purseKey = `${inv.patient_id}|${dayOf(inv.created)}`
      const purseCents = purseByDay.get(purseKey) ?? 0
      if (purseCents >= totalCents) {
        // Real money covered this one -- QuiroFlow already has it as a
        // payment-derived invoice.
        purseByDay.set(purseKey, purseCents - totalCents)
        skippedPaid.value++
        continue
      }

      const patientNumber = inv.patient_id !== null ? patientNumberById.get(String(inv.patient_id)) : undefined
      const ourPatient = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
      if (!ourPatient) {
        skippedUnmatched.value++
        continue
      }

      // Attribute to the most recent package bought on or before the visit.
      // Where that is ambiguous the value is still recorded and the package
      // left unset, rather than guessed.
      // Most recent first, but a bono whose per-session rate equals what this
      // visit was billed wins over one that merely came later. A patient
      // holding a Bono 12 (44 a session) and a Bono 10 (46) would otherwise
      // have every visit filed under whichever they bought last: 117 visits
      // on this account are attributed to a bono whose rate does not match
      // the amount, which is how that shows up. Where nothing matches the
      // value, the most recent still wins -- same answer as before.
      const candidates = (purchasesByPatient.get(ourPatient.id) ?? [])
        .filter((p) => dayOf(p.purchasedAt) <= dayOf(inv.created))
        .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
      const held = candidates.filter((p) => p.rateCents === totalCents).concat(candidates.filter((p) => p.rateCents !== totalCents))
      built.push({
        phInvoiceId: inv.id,
        patientId: ourPatient.id,
        patientName: ourPatient.name,
        amountCents: totalCents,
        usedAt: inv.created,
        appointmentId: (inv.appointment_id !== null && inv.appointment_id !== undefined ? ourApptByRef.get(String(inv.appointment_id)) : undefined) ?? null,
        packagePurchaseId: held[0]?.id ?? null,
        packageName: held[0]?.name ?? null,
      })
    }

    candidates.value = built
    stage.value = 'preview'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

async function applyAll() {
  stage.value = 'applying'
  appliedCount.value = 0
  progress.value = { done: 0, total: candidates.value.length }

  const CHUNK = 200
  for (let i = 0; i < candidates.value.length; i += CHUNK) {
    const chunk = candidates.value.slice(i, i + CHUNK)
    const { error } = await supabase.from('package_sessions').insert(
      chunk.map((c) => ({
        account_id: store.accountId!,
        patient_id: c.patientId,
        package_purchase_id: c.packagePurchaseId,
        appointment_id: c.appointmentId,
        amount_cents: c.amountCents,
        used_at: c.usedAt,
        external_reference: `PH-invoice-${c.phInvoiceId}`,
      })),
    )
    if (error) {
      runError.value = error.message
      stage.value = 'error'
      return
    }
    appliedCount.value += chunk.length
    progress.value = { done: appliedCount.value, total: candidates.value.length }
  }

  stage.value = 'done'
  showToast(t(`Imported ${appliedCount.value} package visit(s).`, `Importadas ${appliedCount.value} visita(s) de bono.`))
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
  else stage.value = 'connect'
}

function formatEuros(cents: number): string {
  return (cents / 100).toFixed(2)
}

const totalValueCents = computed(() => candidates.value.reduce((sum, c) => sum + c.amountCents, 0))
const withPackage = computed(() => candidates.value.filter((c) => c.packagePurchaseId).length)
const withAppointment = computed(() => candidates.value.filter((c) => c.appointmentId).length)
</script>

<template>
  <div>
    <h2 class="text-base font-semibold text-ink-900">{{ t('Package visits (bonos)', 'Visitas de bono') }}</h2>
    <p class="mt-1 max-w-3xl text-[13px] text-ink-muted">
      {{
        t(
          "Brings across the visits patients took out of a bono while still on PracticeHub. QuiroFlow bills one invoice per payment, so those visits currently appear nowhere -- a patient's Billing tab shows the bono purchase and then nothing for the months they were using it. These are display-only lines: no invoice, no charge, and no effect on any balance. Visits made in QuiroFlow are already recorded and are not touched.",
          'Trae las visitas que los pacientes consumieron de un bono mientras aún estaban en PracticeHub. QuiroFlow emite una factura por pago, así que esas visitas no aparecen en ningún sitio -- la pestaña de facturación muestra la compra del bono y luego nada durante los meses en que se usó. Son líneas informativas: sin factura, sin cargo y sin efecto en ningún saldo. Las visitas hechas en QuiroFlow ya están registradas y no se tocan.',
        )
      }}
    </p>

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'loading' || stage === 'applying'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ stage === 'applying' ? t('Importing…', 'Importando…') : phase }}</p>
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
            `${candidates.length} package visit(s) to add, worth €${formatEuros(totalValueCents)} of consumed bono value. ${withPackage} matched to a specific bono, ${withAppointment} linked to an appointment. Skipped: ${skippedPaid} invoices already covered by a payment that day, ${skippedUnmatched} invoices for patients with no matching record here.`,
            `${candidates.length} visita(s) de bono para añadir, por valor de €${formatEuros(totalValueCents)} de bono consumido. ${withPackage} asociadas a un bono concreto, ${withAppointment} vinculadas a una cita. Omitidas: ${skippedPaid} facturas ya cubiertas por un pago ese día, ${skippedUnmatched} facturas de pacientes sin registro aquí.`,
          )
        }}
      </div>

      <div class="rounded-lg border border-line">
        <button type="button" class="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-ink-700" @click="showRawSample = !showRawSample">
          <span>{{ t('Debug: raw PracticeHub invoice (first 3)', 'Depurar: factura cruda de PracticeHub (primeras 3)') }}</span>
          <span class="text-ink-muted2">{{ showRawSample ? '▲' : '▼' }}</span>
        </button>
        <pre v-if="showRawSample" class="overflow-x-auto border-t border-line bg-surface-subtle p-3 text-[11px] leading-relaxed text-ink-700">{{ JSON.stringify(rawSample, null, 2) }}</pre>
      </div>

      <div class="overflow-x-auto rounded-lg border border-line">
        <table class="w-full text-left text-[13px]">
          <thead class="bg-surface-subtle2 text-[11px] uppercase tracking-wide text-ink-faint">
            <tr>
              <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-3 py-2">{{ t('Date', 'Fecha') }}</th>
              <th class="px-3 py-2">{{ t('Package', 'Bono') }}</th>
              <th class="px-3 py-2 text-right">{{ t('Value', 'Valor') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-row">
            <tr v-for="c in candidates.slice(0, 100)" :key="c.phInvoiceId">
              <td class="px-3 py-2 text-ink-700">{{ c.patientName }}</td>
              <td class="px-3 py-2 text-ink-muted">{{ c.usedAt.slice(0, 10) }}</td>
              <td class="px-3 py-2 text-ink-muted">{{ c.packageName ?? '—' }}</td>
              <td class="px-3 py-2 text-right font-mono text-ink-700">€{{ formatEuros(c.amountCents) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="candidates.length > 100" class="text-xs text-ink-faint">
        {{ t(`Showing the first 100 of ${candidates.length}.`, `Mostrando las primeras 100 de ${candidates.length}.`) }}
      </p>

      <button
        type="button"
        :disabled="candidates.length === 0"
        class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
        @click="applyAll"
      >
        {{ t(`Import ${candidates.length} package visit(s)`, `Importar ${candidates.length} visita(s) de bono`) }}
      </button>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 rounded-lg border border-success-border bg-success-bg p-4 text-sm text-success-text">
      {{ t(`Imported ${appliedCount} package visit(s).`, `Importadas ${appliedCount} visita(s) de bono.`) }}
    </div>
  </div>
</template>
