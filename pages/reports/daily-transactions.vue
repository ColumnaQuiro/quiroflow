<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { rangeBounds } from '~/composables/useDateRangePresets'
import { isReceipt } from '~/utils/paymentReceipts'
import { fetchByIds } from '~/composables/useFetchAllRows'

interface PaymentRow {
  id: string
  amount_cents: number
  method: string
  paid_at: string
  // Never null, and the reason the Patient column works for a payment that
  // settles no invoice. This page used to reach the patient through the
  // invoice, so a bono purchase or an on-account top-up -- neither of which
  // raises one -- rendered "Unknown" and linked to /patients/undefined. So
  // did all 3,262 payments imported from PracticeHub, which carry no invoice
  // either: every day before mid-September was a page of "Unknown".
  patient_id: string
  invoice_id: string | null
  invoices?: { status: string } | null
}
interface InvoiceRow { id: string; invoice_number: string; patient_id: string; is_refund: boolean; appointment_id: string | null }
interface PatientRow { id: string; first_name: string; last_name: string | null }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }
interface TeamMemberRow { id: string; full_name: string }

const supabase = useSupabaseClient()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()
const t = useT()

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dateStr = ref(todayISO())
const practitionerFilter = ref('')
const clinicFilter = ref('')
const loading = ref(true)
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const patients = ref<PatientRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const teamMembers = ref<TeamMemberRow[]>([])

function eur(cents: number) {
  return `${formatEur(cents)}`
}
function shiftDay(days: number) {
  const d = new Date(`${dateStr.value}T00:00:00`)
  d.setDate(d.getDate() + days)
  dateStr.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  const { from, to } = rangeBounds({ from: dateStr.value, to: dateStr.value })

  const { data: p } = await supabase
    .from('payments')
    .select('id, amount_cents, method, paid_at, patient_id, invoice_id, invoices!payments_invoice_id_fkey(status)')
    .gte('paid_at', from.toISOString())
    .lte('paid_at', to.toISOString())
    .order('paid_at')
  // The void rule moved out of the query when the join went from inner to
  // left: a payment with no invoice has nothing to void and must survive it.
  payments.value = (p ?? []).filter((row) => row.invoices?.status !== 'void')

  const invoiceIds = [...new Set(payments.value.map((row) => row.invoice_id).filter((id): id is string => !!id))]
  invoices.value = await fetchByIds<InvoiceRow>(invoiceIds, (ids) =>
    supabase.from('invoices').select('id, invoice_number, patient_id, is_refund, appointment_id').in('id', ids),
  )

  // Off the payments, not off the invoices they settle. Half this page's
  // rows settle no invoice at all, and those are exactly the ones whose
  // patient went missing when the list was built the other way round.
  const patientIds = [...new Set(payments.value.map((row) => row.patient_id))]
  patients.value = await fetchByIds<PatientRow>(patientIds, (ids) =>
    supabase.from('patients').select('id, first_name, last_name').in('id', ids),
  )

  // The practitioner comes from the invoice's linked appointment, same as
  // reports/income.vue -- neither payments nor invoices carry the column
  // directly. Fetched on every load, not only when a filter is set: the
  // Practitioner COLUMN reads the same map, so skipping this left every row
  // on the page saying "Unassigned" until someone happened to pick a filter.
  const appointmentIds = [...new Set(invoices.value.map((row) => row.appointment_id).filter((id): id is string => !!id))]
  appointments.value = await fetchByIds<AppointmentRow>(appointmentIds, (ids) =>
    supabase.from('appointments').select('id, practitioner_id, clinic_id').in('id', ids),
  )

  loading.value = false
}

onMounted(() => {
  load()
  loadFilterOptions()
  ensurePaymentMethodsLoaded()
  supabase.from('team_members').select('id, full_name').then(({ data }) => { teamMembers.value = data ?? [] })
})
watch([dateStr, practitionerFilter, clinicFilter], load)

const invoiceById = computed(() => new Map(invoices.value.map((row) => [row.id, row])))
const patientById = computed(() => new Map(patients.value.map((row) => [row.id, row])))
const appointmentById = computed(() => new Map(appointments.value.map((row) => [row.id, row])))
const memberById = computed(() => new Map(teamMembers.value.map((row) => [row.id, row.full_name])))

// A payment settling no particular charge has no invoice to name, and shows
// a dash in the Invoice column rather than a broken lookup.
function invoiceFor(payment: PaymentRow) {
  return payment.invoice_id ? invoiceById.value.get(payment.invoice_id) : undefined
}

function apptFor(payment: PaymentRow) {
  const invoice = payment.invoice_id ? invoiceById.value.get(payment.invoice_id) : undefined
  return invoice?.appointment_id ? appointmentById.value.get(invoice.appointment_id) : undefined
}
const filteredPayments = computed(() =>
  payments.value.filter((row) => {
    if (!practitionerFilter.value && !clinicFilter.value) return true
    const appt = apptFor(row)
    if (!appt) return false
    if (practitionerFilter.value && appt.practitioner_id !== practitionerFilter.value) return false
    if (clinicFilter.value && appt.clinic_id !== clinicFilter.value) return false
    return true
  }),
)

// payments.patient_id is not null, so the only way this misses now is a
// patient row the reader cannot see -- a practitioner scoped to their own
// patients reading a colleague's takings. That is the case "Unknown" is
// actually for; it used to mean "this payment has no invoice", which was
// most of them.
function patientName(patientId: string) {
  const p = patientById.value.get(patientId)
  return p ? `${p.first_name} ${p.last_name ?? ''}`.trim() : t('Unknown', 'Desconocido')
}
function practitionerName(payment: PaymentRow) {
  const appt = apptFor(payment)
  return appt?.practitioner_id ? (memberById.value.get(appt.practitioner_id) ?? t('Unknown', 'Desconocido')) : t('Unassigned', 'Sin asignar')
}
function time(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// This page is read at the end of the day against what is in the drawer and
// what the card terminal says, so it counts only what arrived -- see
// utils/paymentReceipts. Credit spent today is listed in the table below,
// because it happened and staff will look for it, and totalled separately so
// the rows still add up to the cards.
const receipts = computed(() => filteredPayments.value.filter((row) => isReceipt(row.method)))
const netCents = computed(() => receipts.value.reduce((sum, row) => sum + row.amount_cents, 0))
const creditAppliedCents = computed(() =>
  filteredPayments.value.filter((row) => row.method === 'credit').reduce((sum, row) => sum + row.amount_cents, 0),
)
const byMethod = computed(() => {
  const totals = new Map<string, number>()
  for (const row of receipts.value) totals.set(row.method, (totals.get(row.method) ?? 0) + row.amount_cents)
  return [...totals.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents)
})

// Stored keys are not labels: "transfer" and "write_off" were rendered raw in
// the cards and in every row of the table.
const { ensureLoaded: ensurePaymentMethodsLoaded, labelFor: labelForMethod } = usePaymentMethods()
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Daily Transactions', 'Transacciones del día')" :meta="t('Every payment and refund recorded on a given day, for end-of-day cash reconciliation.', 'Todos los pagos y reembolsos registrados en un día, para el cuadre de caja.')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-1 rounded-ctl border border-line-control bg-surface">
          <button type="button" class="flex h-8 w-8 items-center justify-center text-ink-muted2 hover:text-ink-700" @click="shiftDay(-1)">‹</button>
          <input v-model="dateStr" type="date" class="h-8 border-0 bg-transparent px-1 text-[13px] text-ink-700 focus:outline-none" />
          <button type="button" class="flex h-8 w-8 items-center justify-center text-ink-muted2 hover:text-ink-700" @click="shiftDay(1)">›</button>
        </div>
        <button type="button" class="h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-600 hover:bg-surface-subtle" @click="dateStr = todayISO()">
          {{ t('Today', 'Hoy') }}
        </button>
        <ReportsPractitionerClinicFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :practitioners="practitioners" :clinics="clinics" />
      </div>

      <div v-if="loading" class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div v-for="i in 3" :key="i" class="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card">
          <UiSkeleton class="h-3 w-24 rounded-ctlSm" />
          <UiSkeleton class="h-[23px] w-20 rounded-ctlSm" />
        </div>
      </div>

      <template v-else>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Net collected', 'Neto cobrado') }}</p>
            <p data-test="daily-net-collected" class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ eur(netCents) }}</p>
          </div>
          <div v-for="row in byMethod" :key="row.method" class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ labelForMethod(row.method) }}</p>
            <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900">{{ eur(row.cents) }}</p>
          </div>
          <!-- Deliberately outside "Net collected": this money was collected
          on whatever day the patient paid it in, and counting it again here
          would make the day's takings disagree with the drawer. -->
          <div v-if="creditAppliedCents > 0" class="rounded-card border border-dashed border-line-control bg-surface p-4 shadow-card">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Credit applied', 'Crédito aplicado') }}</p>
            <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-muted2">{{ eur(creditAppliedCents) }}</p>
            <p class="mt-1 text-[11px] text-ink-faint2">{{ t('Not money in today', 'No es dinero que entra hoy') }}</p>
          </div>
        </div>

        <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <table class="w-full text-[13px]">
            <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
              <tr>
                <th class="px-4 py-2">{{ t('Time', 'Hora') }}</th>
                <th class="px-4 py-2">{{ t('Patient', 'Paciente') }}</th>
                <th class="px-4 py-2">{{ t('Receipt', 'Recibo') }}</th>
                <th class="px-4 py-2">{{ t('Practitioner', 'Profesional') }}</th>
                <th class="px-4 py-2">{{ t('Method', 'Método') }}</th>
                <th class="px-4 py-2 text-right">{{ t('Amount', 'Importe') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-row">
              <tr v-if="filteredPayments.length === 0">
                <td colspan="6" class="px-4 py-6 text-center text-ink-faint2">{{ t('No transactions on this day.', 'Sin transacciones este día.') }}</td>
              </tr>
              <tr v-for="row in filteredPayments" :key="row.id">
                <td class="px-4 py-2.5 text-ink-muted2">{{ time(row.paid_at) }}</td>
                <td class="px-4 py-2.5 text-ink-900">
                  <NuxtLink :to="`/patients/${row.patient_id}`" class="hover:text-brand-text">
                    {{ patientName(row.patient_id) }}
                  </NuxtLink>
                </td>
                <td class="px-4 py-2.5 text-ink-muted2">
                  <span>{{ invoiceFor(row)?.invoice_number ?? '—' }}</span>
                  <span v-if="invoiceFor(row)?.is_refund" class="ml-1.5 rounded-pill bg-danger-bg px-1.5 py-0.5 text-[11px] font-medium text-danger-text">{{ t('refund', 'reembolso') }}</span>
                </td>
                <td class="px-4 py-2.5 text-ink-muted2">{{ practitionerName(row) }}</td>
                <td class="px-4 py-2.5 text-ink-muted2">{{ labelForMethod(row.method) }}</td>
                <td class="px-4 py-2.5 text-right font-mono" :class="row.amount_cents < 0 ? 'text-danger-text' : 'text-ink-900'">{{ eur(row.amount_cents) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </div>
</template>
