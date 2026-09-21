<script setup lang="ts">
import { formatEur } from '~/utils/billing'
// Imports PracticeHub's ledger as PracticeHub actually keeps it: one invoice
// per visit, one payment per payment, and no invented link between them.
//
// This replaces the reconstruction the Payments importer does. That one had a
// real constraint behind it -- payments.invoice_id was NOT NULL, so a payment
// could only exist by hanging off an invoice, and PracticeHub exposes no
// allocation between the two -- so it raised one paid invoice PER PAYMENT.
// The result reads as "invoices by payment" against PracticeHub's "invoice per
// visit", and reconciling the two has been the source of every billing
// confusion since the migration: a visit with no same-day payment looked like
// a bono visit, a bono looked like unpaid debt, and 566 patients who had never
// paid were never imported at all.
//
// 0170 removed the constraint (payments carry their own patient now), so the
// two sides can finally be imported as they are.
//
// Allocation: PracticeHub records none, and this invents none. Payments
// arrive unallocated and stay that way -- which is what they are, and on this
// account EUR 32,213.50 of them across 208 patients has no invoice to attach
// to anyway, mostly unused bono value. What DOES get derived is each imported
// invoice's status, by walking a patient's invoices oldest-first against the
// total they have paid; see settle_imported_invoices(). No payment row is
// touched by that, and no balance moves, because a balance is paid minus
// invoiced regardless of what any status says.
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

interface PHPatient { id: number; patient_number: string }
interface PHPaymentMethod { id: number; name: string }
interface PHInvoice { id: number; appointment_id: string | null; patient_id: string; total: string; created: string }
interface PHPayment { id: number; amount: string; payment_type_id: string; patient_id: string; note: string | null; created: string }

interface InvoiceCandidate {
  ref: string
  patientId: string
  appointmentId: string | null
  totalCents: number
  createdAt: string
}
interface PaymentCandidate {
  ref: string
  patientId: string
  amountCents: number
  method: string
  paidAt: string
  note: string | null
}

const stage = ref<'connect' | 'scanning' | 'preview' | 'importing' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const invoicesToCreate = ref<InvoiceCandidate[]>([])
const paymentsToCreate = ref<PaymentCandidate[]>([])
const skipped = ref({ invoicesAlready: 0, paymentsAlready: 0, invoicesUnmatched: 0, paymentsUnmatched: 0 })
const phTotals = ref({ invoicedCents: 0, paidCents: 0 })
const importedInvoices = ref(0)
const importedPayments = ref(0)
const allocatedInvoices = ref(0)
const importErrors = ref<string[]>([])

const CHUNK = 200

const introLead = t(
  'Copies PracticeHub’s own invoices and payments across, exactly as it holds them.',
  'Copia las facturas y los pagos propios de PracticeHub, tal y como los tiene.',
)
const introNotes = [
  {
    title: t('One invoice per visit, not one per payment.', 'Una factura por visita, no una por pago.'),
    body: t(
      'This is how PracticeHub keeps it, and it is the difference that made the earlier migration hard to reconcile: the Payments importer raised an invoice for every payment instead.',
      'Así lo guarda PracticeHub, y es la diferencia que dificultó la conciliación anterior: el importador de Pagos creaba una factura por cada pago.',
    ),
  },
  {
    title: t('Payments arrive unallocated, because PracticeHub records no allocation.', 'Los pagos llegan sin asignar, porque PracticeHub no registra ninguna asignación.'),
    body: t(
      'A payment is money from the patient. Invoice statuses are then derived by covering each patient’s visits oldest-first from what they paid — no payment is attached, split or altered.',
      'Un pago es dinero del paciente. El estado de las facturas se deduce cubriendo las visitas más antiguas primero con lo pagado; ningún pago se asigna, divide ni modifica.',
    ),
  },
  {
    title: t('Nothing is written until you press Import.', 'No se escribe nada hasta que pulses Importar.'),
    body: t('The preview totals every invoice and payment it will create, against what PracticeHub holds.', 'La vista previa suma todas las facturas y pagos que creará, frente a lo que tiene PracticeHub.'),
  },
  {
    title: t('Safe to run again, and it deletes nothing.', 'Se puede volver a ejecutar y no elimina nada.'),
    body: t(
      'Rows are keyed by their PracticeHub id, so a second run imports nothing. What is already in QuiroFlow stays untouched, so both pictures can be compared before anything is removed.',
      'Las filas se identifican por su id de PracticeHub, así que una segunda ejecución no importa nada. Lo que ya está en QuiroFlow permanece intacto, para poder comparar ambas imágenes antes de eliminar nada.',
    ),
  },
]

const centsOf = (value: string | null | undefined) => Math.round(parseFloat(value ?? '0') * 100)

async function loadAllOurRows<T>(table: 'patients' | 'appointments' | 'invoices' | 'payments', columns: string): Promise<T[]> {
  const PAGE = 1000
  const rows: T[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as unknown as T[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'scanning'
  runError.value = ''
  importErrors.value = []
  skipped.value = { invoicesAlready: 0, paymentsAlready: 0, invoicesUnmatched: 0, paymentsUnmatched: 0 }
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Loading payment methods…', 'Cargando métodos de pago…')
    const methods = await api.fetchAll<PHPaymentMethod>('/payment_methods')
    // payments.method only accepts card | cash | other, and PracticeHub's names
    // are free text ("GoCardless - Direct Debit Payments").
    const methodById = new Map(
      methods.map((m) => {
        const lower = m.name.toLowerCase()
        return [String(m.id), lower.includes('cash') ? 'cash' : lower.includes('card') ? 'card' : 'other'] as const
      }),
    )

    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const phPatients = await api.fetchAll<PHPatient>('/patients', (done, total) => (progress.value = { done, total }))
    // PracticeHub's own id is not what we store: every importer keys on
    // patient_number, the "Patient Number" the CSV exports.
    const numberByPhId = new Map(phPatients.map((p) => [String(p.id), p.patient_number]))

    const ourPatients = await loadAllOurRows<{ id: string; external_reference: string | null }>('patients', 'id, external_reference')
    const patientByRef = new Map(ourPatients.filter((p) => p.external_reference).map((p) => [p.external_reference as string, p.id]))

    const ourAppointments = await loadAllOurRows<{ id: string; external_reference: string | null }>('appointments', 'id, external_reference')
    const appointmentByRef = new Map(ourAppointments.filter((a) => a.external_reference).map((a) => [a.external_reference as string, a.id]))

    phase.value = t('Reading what is already imported…', 'Leyendo lo ya importado…')
    const ourInvoices = await loadAllOurRows<{ external_reference: string | null }>('invoices', 'external_reference')
    const haveInvoiceRefs = new Set(ourInvoices.map((i) => i.external_reference).filter(Boolean) as string[])
    const ourPayments = await loadAllOurRows<{ external_reference: string | null }>('payments', 'external_reference')
    const havePaymentRefs = new Set(ourPayments.map((p) => p.external_reference).filter(Boolean) as string[])

    phase.value = t('Loading PracticeHub invoices…', 'Cargando facturas de PracticeHub…')
    const phInvoices = await api.fetchAll<PHInvoice>('/invoices', (done, total) => (progress.value = { done, total }))
    phase.value = t('Loading PracticeHub payments…', 'Cargando pagos de PracticeHub…')
    const phPayments = await api.fetchAll<PHPayment>('/payments', (done, total) => (progress.value = { done, total }))

    phTotals.value = {
      invoicedCents: phInvoices.reduce((sum, i) => sum + centsOf(i.total), 0),
      paidCents: phPayments.reduce((sum, p) => sum + centsOf(p.amount), 0),
    }

    const invoices: InvoiceCandidate[] = []
    for (const inv of phInvoices) {
      const ref = `phinv-${inv.id}`
      if (haveInvoiceRefs.has(ref)) {
        skipped.value.invoicesAlready++
        continue
      }
      const patientId = patientByRef.get(numberByPhId.get(String(inv.patient_id)) ?? '')
      if (!patientId) {
        skipped.value.invoicesUnmatched++
        continue
      }
      invoices.push({
        ref,
        patientId,
        appointmentId: inv.appointment_id ? (appointmentByRef.get(String(inv.appointment_id)) ?? null) : null,
        totalCents: centsOf(inv.total),
        createdAt: inv.created,
      })
    }

    const payments: PaymentCandidate[] = []
    for (const pay of phPayments) {
      const ref = `phpay-${pay.id}`
      if (havePaymentRefs.has(ref)) {
        skipped.value.paymentsAlready++
        continue
      }
      const patientId = patientByRef.get(numberByPhId.get(String(pay.patient_id)) ?? '')
      if (!patientId) {
        skipped.value.paymentsUnmatched++
        continue
      }
      payments.push({
        ref,
        patientId,
        amountCents: centsOf(pay.amount),
        method: methodById.get(pay.payment_type_id) ?? 'other',
        paidAt: pay.created,
        note: pay.note,
      })
    }

    invoicesToCreate.value = invoices
    paymentsToCreate.value = payments
    stage.value = 'preview'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

const previewInvoicedCents = computed(() => invoicesToCreate.value.reduce((sum, i) => sum + i.totalCents, 0))
const previewPaidCents = computed(() => paymentsToCreate.value.reduce((sum, p) => sum + p.amountCents, 0))
const previewPatients = computed(
  () => new Set([...invoicesToCreate.value.map((i) => i.patientId), ...paymentsToCreate.value.map((p) => p.patientId)]).size,
)

async function runImport() {
  stage.value = 'importing'
  importedInvoices.value = 0
  importedPayments.value = 0
  allocatedInvoices.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: invoicesToCreate.value.length + paymentsToCreate.value.length }

  try {
    phase.value = t('Creating invoices…', 'Creando facturas…')
    for (let i = 0; i < invoicesToCreate.value.length; i += CHUNK) {
      const chunk = invoicesToCreate.value.slice(i, i + CHUNK)
      const { data, error } = await supabase
        .from('invoices')
        .insert(
          chunk.map((c) => ({
            account_id: store.accountId!,
            patient_id: c.patientId,
            appointment_id: c.appointmentId,
            // Its own series, clear of both INV- and the PH- rows the old
            // reconstruction left behind, so the two can sit side by side
            // while the reconciliation is checked.
            invoice_number: `PHI-${c.ref.replace('phinv-', '')}`,
            external_reference: c.ref,
            // Nothing is allocated yet; the pass below settles what the
            // patient's own payments cover.
            status: 'unpaid',
            total_cents: c.totalCents,
            created_at: c.createdAt,
          })),
        )
        .select('id')
      if (error) importErrors.value.push(t(`Invoices near ${chunk[0]?.ref}: ${error.message}`, `Facturas cerca de ${chunk[0]?.ref}: ${error.message}`))
      else importedInvoices.value += data?.length ?? 0
      progress.value = { ...progress.value, done: progress.value.done + chunk.length }
    }

    phase.value = t('Creating payments…', 'Creando pagos…')
    for (let i = 0; i < paymentsToCreate.value.length; i += CHUNK) {
      const chunk = paymentsToCreate.value.slice(i, i + CHUNK)
      const { data, error } = await supabase
        .from('payments')
        .insert(
          chunk.map((c) => ({
            account_id: store.accountId!,
            patient_id: c.patientId,
            // Unallocated on arrival. This is the row shape 0170 made
            // possible, and the reason this importer does not have to invent
            // an invoice to hang the money on.
            invoice_id: null,
            external_reference: c.ref,
            amount_cents: c.amountCents,
            method: c.method,
            paid_at: c.paidAt,
          })),
        )
        .select('id')
      if (error) importErrors.value.push(t(`Payments near ${chunk[0]?.ref}: ${error.message}`, `Pagos cerca de ${chunk[0]?.ref}: ${error.message}`))
      else importedPayments.value += data?.length ?? 0
      progress.value = { ...progress.value, done: progress.value.done + chunk.length }
    }

    phase.value = t('Settling what the payments cover…', 'Saldando lo que cubren los pagos…')
    // Sets invoice status only -- no payment is allocated, split or otherwise
    // touched. See the migration for why the pairing is deliberately not made.
    const { data: allocated, error: allocError } = await supabase.rpc('settle_imported_invoices', { p_account_id: store.accountId! })
    if (allocError) importErrors.value.push(t(`Allocation: ${allocError.message}`, `Asignación: ${allocError.message}`))
    else allocatedInvoices.value = allocated ?? 0

    stage.value = 'done'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

function retry() {
  if (lastConn.value) run(lastConn.value)
  else stage.value = 'connect'
}

const money = (cents: number) => `${formatEur(cents)}`
</script>

<template>
  <div>
    <ImportIntro :lead="introLead" :notes="introNotes" />

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'scanning' || stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-ctl border border-line bg-surface p-3">
          <p class="text-[12px] uppercase tracking-wide text-ink-faint">{{ t('Invoices to create', 'Facturas a crear') }}</p>
          <p class="mt-0.5 text-[20px] font-semibold text-ink-900">{{ invoicesToCreate.length }}</p>
          <p class="text-[12.5px] text-ink-muted2">{{ money(previewInvoicedCents) }}</p>
        </div>
        <div class="rounded-ctl border border-line bg-surface p-3">
          <p class="text-[12px] uppercase tracking-wide text-ink-faint">{{ t('Payments to create', 'Pagos a crear') }}</p>
          <p class="mt-0.5 text-[20px] font-semibold text-ink-900">{{ paymentsToCreate.length }}</p>
          <p class="text-[12.5px] text-ink-muted2">{{ money(previewPaidCents) }}</p>
        </div>
        <div class="rounded-ctl border border-line bg-surface p-3">
          <p class="text-[12px] uppercase tracking-wide text-ink-faint">{{ t('Patients affected', 'Pacientes afectados') }}</p>
          <p class="mt-0.5 text-[20px] font-semibold text-ink-900">{{ previewPatients }}</p>
          <p class="text-[12.5px] text-ink-muted2">
            {{ t('net', 'neto') }} {{ money(previewPaidCents - previewInvoicedCents) }}
          </p>
        </div>
      </div>

      <div class="rounded-ctl border border-line-divider bg-surface-subtle p-3 text-[12.5px] text-ink-muted2">
        <p>
          {{ t('PracticeHub holds', 'PracticeHub tiene') }} {{ money(phTotals.invoicedCents) }} {{ t('invoiced and', 'facturado y') }}
          {{ money(phTotals.paidCents) }} {{ t('paid', 'pagado') }}.
        </p>
        <p v-if="skipped.invoicesAlready || skipped.paymentsAlready" class="mt-1">
          {{ t('Already imported:', 'Ya importado:') }} {{ skipped.invoicesAlready }} {{ t('invoices', 'facturas') }},
          {{ skipped.paymentsAlready }} {{ t('payments', 'pagos') }}.
        </p>
        <p v-if="skipped.invoicesUnmatched || skipped.paymentsUnmatched" class="mt-1">
          {{ t('No matching patient here:', 'Sin paciente correspondiente aquí:') }} {{ skipped.invoicesUnmatched }}
          {{ t('invoices', 'facturas') }}, {{ skipped.paymentsUnmatched }} {{ t('payments', 'pagos') }}.
          {{ t('Run the Patients import first.', 'Ejecuta antes la importación de Pacientes.') }}
        </p>
      </div>

      <p class="text-[12.5px] text-ink-muted2">
        {{
          t(
            'Nothing is deleted. The invoices and payments already here stay exactly as they are, so both pictures can be compared before anything is removed.',
            'No se elimina nada. Las facturas y pagos ya existentes permanecen igual, para poder comparar ambas imágenes antes de eliminar nada.',
          )
        }}
      </p>

      <UiBtn variant="primary" :disabled="invoicesToCreate.length === 0 && paymentsToCreate.length === 0" @click="runImport">
        {{ t('Import', 'Importar') }}
      </UiBtn>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-3">
      <div class="rounded-ctl border border-line bg-surface p-4">
        <p class="text-[15px] font-semibold text-ink-900">{{ t('Imported', 'Importado') }}</p>
        <ul class="mt-1 space-y-0.5 text-[13px] text-ink-muted2">
          <li>{{ importedInvoices }} {{ t('invoices', 'facturas') }}</li>
          <li>{{ importedPayments }} {{ t('payments', 'pagos') }}</li>
          <li>{{ allocatedInvoices }} {{ t('invoices settled from those payments', 'facturas saldadas con esos pagos') }}</li>
        </ul>
      </div>
      <div v-if="importErrors.length > 0" class="rounded-ctl border border-danger-border bg-danger-bg p-3">
        <p class="text-[13px] font-medium text-danger-text">{{ t('Some rows failed', 'Algunas filas fallaron') }}</p>
        <ul class="mt-1 space-y-0.5 text-[12.5px] text-danger-text">
          <li v-for="(e, i) in importErrors" :key="i">{{ e }}</li>
        </ul>
      </div>
    </div>

    <div v-else-if="stage === 'error'" class="mt-4 rounded-ctl border border-danger-border bg-danger-bg p-4">
      <p class="text-[13px] font-medium text-danger-text">{{ runError }}</p>
      <UiBtn class="mt-2" size="sm" @click="retry">{{ t('Retry', 'Reintentar') }}</UiBtn>
    </div>
  </div>
</template>
