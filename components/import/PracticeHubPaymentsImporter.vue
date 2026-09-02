<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

interface PHPatient { id: number; patient_number: string }
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

const stage = ref<'connect' | 'importing' | 'done'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })

const importedCount = ref(0)
const skippedDuplicate = ref(0)
const skippedUnmatched = ref(0)
const importErrors = ref<string[]>([])

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  stage.value = 'importing'
  const api = usePracticeHubApi(conn)

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
  const ourPatientByRef = new Map<string, string>()
  for (let page = 0; ; page++) {
    const { data } = await supabase.from('patients').select('id, external_reference').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const p of data ?? []) if (p.external_reference) ourPatientByRef.set(p.external_reference, p.id)
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

  phase.value = t('Importing…', 'Importando…')
  progress.value = { done: 0, total: payments.length }

  const CHUNK_SIZE = 50
  for (let i = 0; i < payments.length; i += CHUNK_SIZE) {
    const chunk = payments.slice(i, i + CHUNK_SIZE).filter((p) => {
      const invoiceNumber = `PH-${p.id}`
      if (existingInvoiceNumbers.has(invoiceNumber)) {
        skippedDuplicate.value++
        return false
      }
      const patientNumber = patientNumberById.get(p.patient_id)
      const patientId = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
      if (!patientId) {
        skippedUnmatched.value++
        return false
      }
      return true
    })

    const toInsert = chunk.map((p) => ({
      p,
      patientId: ourPatientByRef.get(patientNumberById.get(p.patient_id) ?? '')!,
      amountCents: Math.round(parseFloat(p.amount) * 100),
    }))

    if (toInsert.length > 0) {
      const { data: invoiceRows, error: invoiceError } = await supabase
        .from('invoices')
        .insert(
          toInsert.map(({ p, patientId, amountCents }) => ({
            account_id: store.accountId!,
            patient_id: patientId,
            invoice_number: `PH-${p.id}`,
            status: 'paid',
            total_cents: amountCents,
            created_at: p.created,
          })),
        )
        .select('id')

      if (invoiceError || !invoiceRows) {
        importErrors.value.push(
          t(
            `Payments ${chunk[0]?.id}-${chunk[chunk.length - 1]?.id}: ${invoiceError?.message}`,
            `Pagos ${chunk[0]?.id}-${chunk[chunk.length - 1]?.id}: ${invoiceError?.message}`,
          ),
        )
      } else {
        const lineItems = toInsert.map(({ p, amountCents }, idx) => ({
          account_id: store.accountId!,
          invoice_id: invoiceRows[idx].id,
          description: p.service || p.note || 'Migrated payment',
          quantity: 1,
          price_cents: amountCents,
        }))
        const paymentRows = toInsert.map(({ p, amountCents }, idx) => ({
          account_id: store.accountId!,
          invoice_id: invoiceRows[idx].id,
          amount_cents: amountCents,
          method: methodById.get(p.payment_type_id) ?? 'other',
          paid_at: p.created,
        }))
        const [{ error: liError }, { error: payError }] = await Promise.all([
          supabase.from('invoice_line_items').insert(lineItems),
          supabase.from('payments').insert(paymentRows),
        ])
        if (liError)
          importErrors.value.push(
            t(
              `Line items for payments near ${chunk[0]?.id}: ${liError.message}`,
              `Conceptos de pagos cerca de ${chunk[0]?.id}: ${liError.message}`,
            ),
          )
        if (payError)
          importErrors.value.push(
            t(`Payments near ${chunk[0]?.id}: ${payError.message}`, `Pagos cerca de ${chunk[0]?.id}: ${payError.message}`),
          )
        importedCount.value += invoiceRows.length
      }
    }

    progress.value = { done: Math.min(i + CHUNK_SIZE, payments.length), total: payments.length }
  }

  stage.value = 'done'
}

function reset() {
  stage.value = 'connect'
  importedCount.value = 0
  skippedDuplicate.value = 0
  skippedUnmatched.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}
</script>

<template>
  <div>
    <p class="text-sm text-gray-500">
      {{
        t(
          "Pulls directly from PracticeHub's API (Payments, matched to patients) — no CSV needed. Each payment becomes a paid invoice + line item + payment record here, since PracticeHub's API doesn't expose which invoice a payment was allocated to. Safe to re-run — already-imported payments are skipped.",
          'Obtiene los datos directamente de la API de PracticeHub (Payments, emparejados con pacientes); no se necesita CSV. Cada pago se convierte aquí en una factura pagada + un concepto + un registro de pago, ya que la API de PracticeHub no expone a qué factura se asignó un pago. Se puede volver a ejecutar sin riesgo: los pagos ya importados se omiten.',
        )
      }}
    </p>

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'importing'" class="mt-4 rounded-lg border border-gray-200 bg-white p-8 text-center">
      <p class="text-sm text-gray-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-gray-400">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        {{
          t(
            `Imported ${importedCount} payments. Skipped ${skippedDuplicate} already-imported, ${skippedUnmatched} with no matching patient.`,
            `Se importaron ${importedCount} pagos. Se omitieron ${skippedDuplicate} ya importados, ${skippedUnmatched} sin paciente coincidente.`,
          )
        }}
      </div>
      <div v-if="importErrors.length > 0" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p class="font-medium">{{ t('Some rows failed:', 'Algunas filas fallaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="(e, i) in importErrors" :key="i">{{ e }}</li>
        </ul>
      </div>
      <div class="flex gap-3">
        <NuxtLink to="/reports/income" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {{ t('View Income Report', 'Ver informe de ingresos') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50" @click="reset">
          {{ t('Run again', 'Ejecutar de nuevo') }}
        </button>
      </div>
    </div>
  </div>
</template>
