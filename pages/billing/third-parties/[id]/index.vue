<script setup lang="ts">
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { formatEur } from '~/utils/billing'
import { AGE_BUCKETS, ageBucketLabel, agedOutstanding, allocateOldestFirst, allocatedCents, chargeOutstandingCents, eurosToCents, thirdPartyKindLabel } from '~/utils/thirdParties'

// One third party's account: the visits charged to it, what it has paid, and
// recording a payment from it spread over those visits (20261023093754).
//
// A payment is written with its allocations in one call
// (record_third_party_payment), and the database refuses an allocation that
// pays more than a visit is for or spends more than the payment brought in --
// so two people reconciling the same remittance cannot overshoot between them.

const route = useRoute()
const supabase = useSupabaseClient()
const { can } = usePermission()
const t = useT()
const { showToast } = useToast()
const id = computed(() => String(route.params.id))

interface ChargeRow {
  id: string
  patient_id: string
  appointment_id: string | null
  amount_cents: number
  status: string
  service_date: string
  description: string
  policy_number: string | null
  authorization_number: string | null
  patients: { first_name: string; last_name: string | null } | null
  allocations: { amount_cents: number }[]
}
interface PaymentRow {
  id: string
  amount_cents: number
  received_on: string
  method: string
  reference: string | null
  notes: string | null
  allocations: { amount_cents: number }[]
}

const loading = ref(true)
const thirdParty = ref<{ id: string; name: string; kind: string; tax_id: string | null } | null>(null)
const charges = ref<ChargeRow[]>([])
const payments = ref<PaymentRow[]>([])
const show = ref<'open' | 'all'>('open')

async function load() {
  const [{ data: tp }, rows, { data: pays }] = await Promise.all([
    supabase.from('third_parties').select('id, name, kind, tax_id').eq('id', id.value).maybeSingle(),
    fetchAllRows<ChargeRow>(
      (from, to) =>
        supabase
          .from('third_party_charges')
          .select(
            'id, patient_id, appointment_id, amount_cents, status, service_date, description, policy_number, authorization_number, patients(first_name, last_name), allocations:third_party_payment_allocations(amount_cents)',
          )
          .eq('third_party_id', id.value)
          .order('service_date', { ascending: false })
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: ChargeRow[] | null; error: unknown }>,
    ),
    supabase
      .from('third_party_payments')
      .select('id, amount_cents, received_on, method, reference, notes, allocations:third_party_payment_allocations(amount_cents)')
      .eq('third_party_id', id.value)
      .order('received_on', { ascending: false }),
  ])
  thirdParty.value = tp
  charges.value = rows
  payments.value = (pays as unknown as PaymentRow[] | null) ?? []
  loading.value = false
}
onMounted(load)

const today = new Date().toISOString().slice(0, 10)
const aged = computed(() => agedOutstanding(charges.value, today))
const visibleCharges = computed(() => (show.value === 'open' ? charges.value.filter((c) => chargeOutstandingCents(c) > 0) : charges.value))
const openChargesOldestFirst = computed(() =>
  charges.value.filter((c) => chargeOutstandingCents(c) > 0).sort((a, b) => a.service_date.localeCompare(b.service_date) || a.id.localeCompare(b.id)),
)

const patientName = (c: ChargeRow) => (c.patients ? `${c.patients.first_name} ${c.patients.last_name ?? ''}`.trim() : '—')
// In the interface language, as the receipts are, not the browser's.
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(t('en-GB', 'es-ES'), { day: '2-digit', month: '2-digit', year: 'numeric' })
const methodLabel = (m: string) =>
  ({ transfer: t('Transfer', 'Transferencia'), card: t('Card', 'Tarjeta'), cash: t('Cash', 'Efectivo'), cheque: t('Cheque', 'Cheque'), other: t('Other', 'Otro') })[m] ?? m

// --- recording a payment ---

const paying = ref(false)
const payAmount = ref('')
const payDate = ref(today)
const payMethod = ref('transfer')
const payReference = ref('')
const payNotes = ref('')
const apply = ref<Record<string, string>>({})
const saving = ref(false)
const payError = ref('')

function spread() {
  const cents = eurosToCents(payAmount.value) ?? 0
  const out = allocateOldestFirst(openChargesOldestFirst.value, cents)
  apply.value = Object.fromEntries(openChargesOldestFirst.value.map((c) => [c.id, out.has(c.id) ? (out.get(c.id)! / 100).toFixed(2) : '']))
}
watch(payAmount, spread)

function startPayment() {
  payError.value = ''
  payAmount.value = ''
  payReference.value = ''
  payNotes.value = ''
  payDate.value = today
  payMethod.value = 'transfer'
  paying.value = true
  spread()
}

const appliedCents = computed(() => Object.values(apply.value).reduce((s, v) => s + (eurosToCents(v) ?? 0), 0))
const payCents = computed(() => eurosToCents(payAmount.value) ?? 0)

async function savePayment() {
  payError.value = ''
  if (payCents.value <= 0) {
    payError.value = t('Enter the amount received.', 'Indica el importe recibido.')
    return
  }
  if (appliedCents.value > payCents.value) {
    payError.value = t('More is applied to visits than was received.', 'Se aplica a visitas más de lo recibido.')
    return
  }
  const allocations = []
  for (const c of openChargesOldestFirst.value) {
    const cents = eurosToCents(apply.value[c.id]) ?? 0
    if (cents <= 0) continue
    if (cents > chargeOutstandingCents(c)) {
      payError.value = t(`More than is owed on the visit of ${fmtDate(c.service_date)}.`, `Más de lo pendiente en la visita del ${fmtDate(c.service_date)}.`)
      return
    }
    allocations.push({ charge_id: c.id, amount_cents: cents })
  }
  saving.value = true
  const { error } = await supabase.rpc('record_third_party_payment', {
    p_third_party_id: id.value,
    p_amount_cents: payCents.value,
    p_received_on: payDate.value || today,
    p_method: payMethod.value,
    p_reference: payReference.value,
    p_notes: payNotes.value,
    p_allocations: allocations,
  })
  saving.value = false
  if (error) {
    payError.value = error.message
    return
  }
  paying.value = false
  await load()
}

// Asked first: one click on a bare "Delete" used to remove the payment and
// every allocation on it, with no way back.
const deleting = ref<PaymentRow | null>(null)
const deletingBusy = ref(false)
async function deletePayment() {
  const p = deleting.value
  if (!p) return
  deletingBusy.value = true
  const { error } = await supabase.from('third_party_payments').delete().eq('id', p.id)
  deletingBusy.value = false
  deleting.value = null
  if (error) return showToast(error.message, 'error')
  await load()
}

// The statement covers last month by default: that is the one a clinic sends.
const lastMonth = (() => {
  const d = new Date()
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  const last = new Date(d.getFullYear(), d.getMonth(), 0)
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return { from: iso(first), to: iso(last) }
})()
const stmtFrom = ref(lastMonth.from)
const stmtTo = ref(lastMonth.to)

const field = 'h-9 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-900 focus:border-brand focus:outline-none touch:h-11'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="thirdParty?.name ?? t('Third party', 'Tercero')" :meta="thirdParty ? thirdPartyKindLabel(thirdParty.kind, t) + (thirdParty.tax_id ? ` · ${thirdParty.tax_id}` : '') : ''">
      <div class="flex items-center gap-3">
        <NuxtLink to="/billing/third-parties" class="inline-flex h-9 items-center gap-1 text-[13px] text-ink-muted2 hover:text-ink-600 touch:h-11"><UiChevron />{{ t('Third parties', 'Terceros') }}</NuxtLink>
        <UiBtn v-if="can('payments_allocate')" variant="primary" data-cy="tp-record-payment" @click="startPayment">{{ t('Record payment', 'Registrar cobro') }}</UiBtn>
      </div>
    </PageHeader>

    <div class="flex-1 space-y-4 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="tp-detail" :data-ready="loading ? undefined : 'true'">
      <!-- Skeletons until loaded: every tile read "0,00 €" while the charges
           were on their way, which is a claim, not a placeholder. -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div class="col-span-2 rounded-card border border-line bg-surface p-3 shadow-card sm:col-span-1">
          <UiSkeleton v-if="loading" class="my-1 h-5 w-24 rounded-ctlSm" />
          <p v-else class="font-mono text-[20px] font-semibold text-ink-900" data-cy="tp-detail-owed">{{ formatEur(aged.total) }}</p>
          <p class="text-[12px] text-ink-muted2">{{ t('Owed', 'Pendiente') }}</p>
        </div>
        <div v-for="b in AGE_BUCKETS" :key="b" class="min-w-0 rounded-card border border-line bg-surface p-3 shadow-card">
          <UiSkeleton v-if="loading" class="my-1 h-4 w-16 rounded-ctlSm" />
          <p v-else class="whitespace-nowrap font-mono text-[16px] text-ink-900">{{ formatEur(aged[b]) }}</p>
          <p class="text-[12px] text-ink-muted2">{{ ageBucketLabel(b, t) }}</p>
        </div>
      </div>

      <form v-if="paying" class="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="tp-payment-form" @submit.prevent="savePayment">
        <h2 class="text-[14.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Payment received', 'Cobro recibido') }}</h2>
        <div class="flex flex-wrap items-end gap-3">
          <label class="text-[12px] font-medium text-ink-700">{{ t('Amount (€)', 'Importe (€)') }}
            <input v-model="payAmount" data-cy="tp-payment-amount" type="text" inputmode="decimal" :class="field" class="mt-1 block w-28" />
          </label>
          <label class="text-[12px] font-medium text-ink-700">{{ t('Received on', 'Fecha') }}
            <input v-model="payDate" type="date" :class="field" class="mt-1 block" />
          </label>
          <label class="text-[12px] font-medium text-ink-700">{{ t('Method', 'Método') }}
            <select v-model="payMethod" :class="field" class="mt-1 block">
              <option v-for="m in ['transfer', 'card', 'cash', 'cheque', 'other']" :key="m" :value="m">{{ methodLabel(m) }}</option>
            </select>
          </label>
          <label class="text-[12px] font-medium text-ink-700">{{ t('Reference', 'Referencia') }}
            <input v-model="payReference" type="text" :class="field" class="mt-1 block w-40" />
          </label>
          <label class="min-w-[160px] flex-1 text-[12px] font-medium text-ink-700">{{ t('Notes', 'Notas') }}
            <input v-model="payNotes" type="text" :class="field" class="mt-1 block w-full" />
          </label>
        </div>
        <div v-if="openChargesOldestFirst.length" class="rounded-ctl border border-line">
          <div class="flex items-center justify-between gap-3 border-b border-line bg-surface-subtle px-3 py-1.5 text-[12px] text-ink-muted2">
            <span class="min-w-0">{{ t('Applied to visits, oldest first — change any amount', 'Aplicado a visitas, de la más antigua — puedes cambiar cualquier importe') }}</span>
            <span class="shrink-0 whitespace-nowrap font-mono" :class="appliedCents > payCents ? 'text-danger-text' : 'text-ink-700'">{{ formatEur(appliedCents) }} / {{ formatEur(payCents) }}</span>
          </div>
          <div class="max-h-72 divide-y divide-line-row overflow-y-auto">
            <!-- Two lines on a phone (date and who, then owed and applied), one
                 from sm: in one row the patient's name had no room left at all. -->
            <div v-for="c in openChargesOldestFirst" :key="c.id" class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[13px] sm:flex" data-cy="tp-payment-line">
              <span class="shrink-0 text-ink-muted sm:w-24">{{ fmtDate(c.service_date) }}</span>
              <span class="min-w-0 truncate text-ink-900 sm:flex-1">{{ patientName(c) }} · {{ c.description }}</span>
              <div class="col-span-2 flex items-center justify-end gap-3 sm:contents">
                <span class="shrink-0 whitespace-nowrap font-mono text-ink-muted">{{ formatEur(chargeOutstandingCents(c)) }}</span>
                <input v-model="apply[c.id]" type="text" inputmode="decimal" :aria-label="t('Apply (€)', 'Aplicar (€)')" :class="field" class="w-24 text-right font-mono" />
              </div>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <UiBtn type="submit" variant="primary" data-cy="tp-payment-save" :disabled="saving">{{ saving ? t('Saving…', 'Guardando…') : t('Save payment', 'Guardar cobro') }}</UiBtn>
          <UiBtn @click="paying = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          <p v-if="payError" role="alert" class="text-[12.5px] font-semibold text-danger-text">{{ payError }}</p>
        </div>
      </form>

      <section class="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <div class="flex flex-wrap items-center gap-3 px-4 py-3">
          <h2 class="flex-1 text-[14.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Visits charged', 'Visitas facturadas') }}</h2>
          <select v-model="show" :class="field" :aria-label="t('Show', 'Mostrar')">
            <option value="open">{{ t('Still owed', 'Pendientes') }}</option>
            <option value="all">{{ t('All', 'Todas') }}</option>
          </select>
        </div>
        <table class="w-full min-w-[720px] text-[13px]">
          <thead class="border-y border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2">
            <tr>
              <th class="px-4 py-2">{{ t('Date', 'Fecha') }}</th>
              <th class="px-4 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-4 py-2">{{ t('Service', 'Servicio') }}</th>
              <th class="px-4 py-2">{{ t('Policy / auth.', 'Póliza / autoriz.') }}</th>
              <th class="px-4 py-2 text-right">{{ t('Amount', 'Importe') }}</th>
              <th class="px-4 py-2 text-right">{{ t('Owed', 'Pendiente') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-row">
            <ReportsTableSkeletonRows v-if="loading" :cols="6" />
            <tr v-else-if="visibleCharges.length === 0">
              <td colspan="6" class="px-4 py-6 text-center text-ink-faint2">{{ t('Nothing owed.', 'Nada pendiente.') }}</td>
            </tr>
            <tr v-for="c in loading ? [] : visibleCharges" :key="c.id" data-cy="tp-charge-row" :class="c.status === 'void' ? 'text-ink-faint2 line-through' : ''">
              <td class="whitespace-nowrap px-4 py-2">{{ fmtDate(c.service_date) }}</td>
              <td class="px-4 py-2"><NuxtLink :to="`/patients/${c.patient_id}`" class="hover:text-brand-text">{{ patientName(c) }}</NuxtLink></td>
              <td class="px-4 py-2">{{ c.description }}</td>
              <td class="px-4 py-2 text-ink-muted">{{ [c.policy_number, c.authorization_number].filter(Boolean).join(' / ') || '—' }}</td>
              <td class="whitespace-nowrap px-4 py-2 text-right font-mono">{{ formatEur(c.amount_cents) }}</td>
              <td class="whitespace-nowrap px-4 py-2 text-right font-mono" data-cy="tp-charge-owed">{{ formatEur(chargeOutstandingCents(c)) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <h2 class="px-4 py-3 text-[14.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Payments received', 'Cobros recibidos') }}</h2>
        <div v-if="loading" class="space-y-3 border-t border-line px-4 py-3">
          <UiSkeleton class="h-3.5 w-56 rounded-ctlSm" />
          <UiSkeleton class="h-3.5 w-40 rounded-ctlSm" />
        </div>
        <p v-else-if="payments.length === 0" class="border-t border-line px-4 py-4 text-center text-[13px] text-ink-faint2">{{ t('No payments yet.', 'Aún no hay cobros.') }}</p>
        <div v-for="p in payments" :key="p.id" class="flex flex-wrap items-center gap-3 border-t border-line-row px-4 py-2 text-[13px]" data-cy="tp-payment-row">
          <span class="w-24 text-ink-muted">{{ fmtDate(p.received_on) }}</span>
          <span class="whitespace-nowrap font-mono text-ink-900">{{ formatEur(p.amount_cents) }}</span>
          <span class="text-ink-muted">{{ methodLabel(p.method) }}<span v-if="p.reference"> · {{ p.reference }}</span></span>
          <span class="flex-1 text-[12px] text-ink-muted2">
            {{ t(`${formatEur(allocatedCents(p))} applied to visits`, `${formatEur(allocatedCents(p))} aplicado a visitas`) }}
          </span>
          <UiIconBtn v-if="can('payments_allocate')" icon="trash" tone="danger" :label="t('Delete payment', 'Eliminar cobro')" data-cy="tp-payment-delete" @click="deleting = p" />
        </div>
      </section>

      <section class="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="w-full sm:w-auto sm:flex-1">
          <h2 class="text-[14.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Statement', 'Liquidación') }}</h2>
          <p class="text-[12.5px] text-ink-muted2">{{ t('Every visit charged in a period, to send to the third party.', 'Todas las visitas facturadas en un periodo, para enviar al tercero.') }}</p>
        </div>
        <label class="text-[12px] font-medium text-ink-700">{{ t('From', 'Desde') }}<input v-model="stmtFrom" type="date" :class="field" class="mt-1 block" /></label>
        <label class="text-[12px] font-medium text-ink-700">{{ t('To', 'Hasta') }}<input v-model="stmtTo" type="date" :class="field" class="mt-1 block" /></label>
        <NuxtLink
          :to="`/billing/third-parties/${id}/statement?from=${stmtFrom}&to=${stmtTo}`"
          target="_blank"
          data-cy="tp-statement-link"
          class="inline-flex h-9 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 hover:border-line-controlHover touch:h-11"
        >
          {{ t('Open statement', 'Abrir liquidación') }}
        </NuxtLink>
      </section>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t('Delete this payment?', '¿Eliminar este cobro?')"
      :confirm-label="t('Delete payment', 'Eliminar cobro')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="deletingBusy"
      @confirm="deletePayment"
      @cancel="deleting = null"
    >
      <p class="text-[13px] text-ink-muted">
        {{ t(`${formatEur(deleting.amount_cents)} received on ${fmtDate(deleting.received_on)}. The visits it paid show as owed again.`, `${formatEur(deleting.amount_cents)} recibido el ${fmtDate(deleting.received_on)}. Las visitas que cubría vuelven a quedar pendientes.`) }}
      </p>
    </UiConfirmDialog>
  </div>
</template>
