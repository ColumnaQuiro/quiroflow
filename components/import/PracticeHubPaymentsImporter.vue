<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface PHPatient { id: number; patient_number: string; first_name?: string | null; last_name?: string | null }
interface PHPaymentMethod { id: number; name: string }
interface PHPayment {
  id: number
  amount: string
  payment_type_id: string
  patient_id: string
  service: string | null
  note: string | null
  created: string
}

interface PaymentCandidate {
  payment: PHPayment
  patientId: string
  patientLabel: string
  amountCents: number
  method: string
}

const stage = ref<'connect' | 'scanning' | 'preview' | 'importing' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const candidates = ref<PaymentCandidate[]>([])
const skippedDuplicate = ref(0)
const skippedUnmatched = ref(0)

const importedCount = ref(0)
const importErrors = ref<string[]>([])

function formatEuros(cents: number): string {
  return (cents / 100).toFixed(2)
}

function formatDate(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

const totalCents = computed(() => candidates.value.reduce((sum, c) => sum + c.amountCents, 0))

const previewColumns = computed(() => [
  { key: 'date', label: t('Date', 'Fecha') },
  { key: 'patient', label: t('Patient', 'Paciente') },
  { key: 'description', label: t('Description', 'Concepto'), wrap: true },
  { key: 'method', label: t('Method', 'Método') },
  { key: 'amount', label: t('Amount', 'Importe') },
])

const previewRows = computed(() =>
  candidates.value.map((c) => ({
    date: formatDate(c.payment.created),
    patient: c.patientLabel,
    description: c.payment.service || c.payment.note || t('Migrated payment', 'Pago migrado'),
    method: c.method,
    amount: `€${formatEuros(c.amountCents)}`,
  })),
)

const previewStats = computed(() => [
  { label: t('Will import', 'Se importarán'), value: candidates.value.length, tone: 'good' as const },
  { label: t('Total', 'Total'), value: `€${formatEuros(totalCents.value)}` },
  { label: t('Already imported', 'Ya importados'), value: skippedDuplicate.value },
  { label: t('No matching patient', 'Sin paciente coincidente'), value: skippedUnmatched.value },
])

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'scanning'
  runError.value = ''
  candidates.value = []
  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  importedCount.value = 0
  importErrors.value = []
  const api = usePracticeHubApi(conn)

  try {
    // PracticeHub's payment_allocations endpoint exposes no invoice/payment
    // link fields (a real gap in their public API, confirmed against a live
    // record) -- there's no way to know which invoice a payment applies to.
    // So invoices are reconstructed FROM payments (one per payment, marked
    // paid) rather than imported from PracticeHub's own invoices, which
    // reflects what patients actually paid and keeps revenue reports accurate
    // without guessing at unpaid/void status on historical records.
    phase.value = t('Loading payment methods…', 'Cargando métodos de pago…')
    const methods = await api.fetchAll<PHPaymentMethod>('/payment_methods')
    // Our payments.method column only accepts 'card' | 'cash' | 'other' --
    // map PracticeHub's free-text method names (which include things like
    // "GoCardless - Direct Debit Payments") down to that fixed set.
    const methodById = new Map(
      methods.map((m) => {
        const lower = m.name.toLowerCase()
        const mapped = lower.includes('cash') ? 'cash' : lower.includes('card') ? 'card' : 'other'
        return [String(m.id), mapped]
      }),
    )

    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const phPatients = await api.fetchAll<PHPatient>('/patients', (done, total) => (progress.value = { done, total }))
    const patientNumberById = new Map(phPatients.map((p) => [String(p.id), p.patient_number]))

    const PAGE_SIZE = 1000
    const ourPatientByRef = new Map<string, { id: string; label: string }>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('patients')
        .select('id, external_reference, first_name, last_name')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const p of data ?? [])
        if (p.external_reference)
          ourPatientByRef.set(p.external_reference, { id: p.id, label: `${p.first_name} ${p.last_name ?? ''}`.trim() })
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Checking for already-imported payments…', 'Comprobando pagos ya importados…')
    const existingInvoiceNumbers = new Set<string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('invoices')
        .select('invoice_number')
        .like('invoice_number', 'PH-%')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const inv of data ?? []) existingInvoiceNumbers.add(inv.invoice_number)
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Fetching payments…', 'Obteniendo pagos…')
    progress.value = { done: 0, total: 0 }
    const payments = await api.fetchAll<PHPayment>('/payments', (done, total) => (progress.value = { done, total }))

    const planned: PaymentCandidate[] = []
    for (const p of payments) {
      if (existingInvoiceNumbers.has(`PH-${p.id}`)) {
        skippedDuplicate.value++
        continue
      }
      const patientNumber = patientNumberById.get(p.patient_id)
      const patient = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
      if (!patient) {
        skippedUnmatched.value++
        continue
      }
      planned.push({
        payment: p,
        patientId: patient.id,
        patientLabel: patient.label,
        amountCents: Math.round(parseFloat(p.amount) * 100),
        method: methodById.get(p.payment_type_id) ?? 'other',
      })
    }

    candidates.value = planned
    stage.value = 'preview'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

async function apply() {
  stage.value = 'importing'
  importedCount.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: candidates.value.length }

  try {
    const CHUNK_SIZE = 50
    for (let i = 0; i < candidates.value.length; i += CHUNK_SIZE) {
      const chunk = candidates.value.slice(i, i + CHUNK_SIZE)

      const { data: invoiceRows, error: invoiceError } = await supabase
        .from('invoices')
        .insert(
          chunk.map((c) => ({
            account_id: store.accountId!,
            patient_id: c.patientId,
            invoice_number: `PH-${c.payment.id}`,
            status: 'paid',
            total_cents: c.amountCents,
            created_at: c.payment.created,
          })),
        )
        .select('id')

      if (invoiceError || !invoiceRows) {
        importErrors.value.push(
          t(
            `Payments ${chunk[0]?.payment.id}-${chunk[chunk.length - 1]?.payment.id}: ${invoiceError?.message}`,
            `Pagos ${chunk[0]?.payment.id}-${chunk[chunk.length - 1]?.payment.id}: ${invoiceError?.message}`,
          ),
        )
      } else {
        const lineItems = chunk.map((c, idx) => ({
          account_id: store.accountId!,
          invoice_id: invoiceRows[idx].id,
          description: c.payment.service || c.payment.note || 'Migrated payment',
          quantity: 1,
          price_cents: c.amountCents,
        }))
        const paymentRows = chunk.map((c, idx) => ({
          account_id: store.accountId!,
          invoice_id: invoiceRows[idx].id,
          amount_cents: c.amountCents,
          method: c.method,
          paid_at: c.payment.created,
        }))
        const [{ error: liError }, { error: payError }] = await Promise.all([
          supabase.from('invoice_line_items').insert(lineItems),
          supabase.from('payments').insert(paymentRows),
        ])
        if (liError)
          importErrors.value.push(
            t(
              `Line items for payments near ${chunk[0]?.payment.id}: ${liError.message}`,
              `Conceptos de pagos cerca de ${chunk[0]?.payment.id}: ${liError.message}`,
            ),
          )
        if (payError)
          importErrors.value.push(
            t(
              `Payments near ${chunk[0]?.payment.id}: ${payError.message}`,
              `Pagos cerca de ${chunk[0]?.payment.id}: ${payError.message}`,
            ),
          )
        importedCount.value += invoiceRows.length
      }

      progress.value = { done: Math.min(i + CHUNK_SIZE, candidates.value.length), total: candidates.value.length }
    }
  } catch (err) {
    // Anything escaping the per-chunk error collection above would otherwise
    // leave the UI stuck on "Importing…". Re-running is safe -- payments
    // already written are skipped as duplicates on the next scan.
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
    return
  }

  stage.value = 'done'
  showToast(
    t(
      `Imported ${importedCount.value} payments. Skipped ${skippedDuplicate.value} already-imported, ${skippedUnmatched.value} with no matching patient.`,
      `Se importaron ${importedCount.value} pagos. Se omitieron ${skippedDuplicate.value} ya importados, ${skippedUnmatched.value} sin paciente coincidente.`,
    ),
    importErrors.value.length > 0 ? 'error' : 'success',
  )
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  candidates.value = []
  importedCount.value = 0
  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}
</script>

<template>
  <div>
    <p class="text-sm text-ink-muted2">
      {{
        t(
          "Pulls directly from PracticeHub's API (Payments, matched to patients) — no CSV needed. Each payment becomes a paid invoice + line item + payment record here, since PracticeHub's API doesn't expose which invoice a payment was allocated to. Nothing is written until you review the summary and confirm. Safe to re-run — already-imported payments are skipped.",
          'Obtiene los datos directamente de la API de PracticeHub (Payments, emparejados con pacientes); no se necesita CSV. Cada pago se convierte aquí en una factura pagada + un concepto + un registro de pago, ya que la API de PracticeHub no expone a qué factura se asignó un pago. No se escribe nada hasta que revises el resumen y confirmes. Se puede volver a ejecutar sin riesgo: los pagos ya importados se omiten.',
        )
      }}
    </p>

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'scanning' || stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ stage === 'importing' ? t('Importing…', 'Importando…') : phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <ImportPreviewPanel
      v-else-if="stage === 'preview'"
      class="mt-4"
      :stats="previewStats"
      :columns="previewColumns"
      :rows="previewRows"
      :apply-label="t(`Import ${candidates.length} payment(s)`, `Importar ${candidates.length} pago(s)`)"
      :more-label="t('more payments', 'pagos más')"
      @apply="apply"
      @cancel="reset"
    />

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Import failed:', 'Error al importar:') }}</p>
        <p class="mt-1">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover" @click="retryRun">
        {{ t('Retry', 'Reintentar') }}
      </button>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div v-if="importErrors.length > 0" class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Some rows failed:', 'Algunas filas fallaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="(e, i) in importErrors" :key="i">{{ e }}</li>
        </ul>
      </div>
      <div class="flex gap-3">
        <NuxtLink to="/reports/income" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
          {{ t('View Income Report', 'Ver informe de ingresos') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Run again', 'Ejecutar de nuevo') }}
        </button>
      </div>
    </div>
  </div>
</template>
