<script setup lang="ts">
// Transacciones del día, on the phone: the web's pages/reports/daily-
// transactions.vue -- the same single query, the same void rule, the same
// receipts-only total (utils/paymentReceipts) and the same attribution as
// Income (utils/incomeAttribution), so the day's total here is the drawer
// figure the web shows. Reshaped for a phone: a day stepper chip instead of
// the inline date field, the per-method cards as tiles, and the seven-column
// table as a list (patient and amount; time, method, purpose, practitioner
// and receipt number underneath). Left out: the PDF button (no PDF on the app
// yet).
import { formatEur } from '../../../utils/billing'
import { rangeBounds } from '../../../composables/useDateRangePresets'
import { isReceipt } from '../../../utils/paymentReceipts'
import { classifyPaymentForFilter, practitionerForPayment } from '../../../utils/incomeAttribution'

definePageMeta({ layout: 'practitioner' })

interface PaymentRow {
  id: string
  amount_cents: number
  method: string
  paid_at: string
  // Never null, and the reason the Patient column works for a payment that
  // settles no invoice (a bono purchase, an on-account top-up, everything
  // imported from PracticeHub). The web page used to reach the patient
  // through the invoice and rendered "Unknown" for all of those.
  patient_id: string
  // What the money was for -- 'visit', 'bono', 'membership', 'on_account'.
  // Null on everything imported from PracticeHub, which never recorded it.
  purpose: string | null
  invoice_id: string | null
  invoices?: { status: string } | null
}
interface InvoiceRow { id: string; invoice_number: string; patient_id: string; is_refund: boolean; appointment_id: string | null }
// default_practitioner_id and clinic_id are here for attribution, not for
// display: they are what answers "whose money is this" for a payment with no
// visit behind it. See utils/incomeAttribution.
interface PatientRow { id: string; first_name: string; last_name: string | null; default_practitioner_id: string | null; clinic_id: string | null }
interface AppointmentRow { id: string; practitioner_id: string | null; clinic_id: string | null }
interface TeamMemberRow { id: string; full_name: string }

const PATH = '/reports/daily-transactions'
const supabase = useSupabaseClient()
const t = useT()
const { canOpen, context, reportsPractitionerId } = useReportAccess()
const { shown } = usePrivacyMode()
const { practitioners, clinics, load: loadFilterOptions } = useReportFilterOptions()

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dateStr = ref(todayISO())
// reports_own_only: pinned to the viewer (ReportPeopleFilters' lockedTo).
const practitionerFilter = ref(reportsPractitionerId.value ?? '')
const clinicFilter = ref('')
const loading = ref(true)
const failed = ref(false)
const payments = ref<PaymentRow[]>([])
const invoices = ref<InvoiceRow[]>([])
const patients = ref<PatientRow[]>([])
const appointments = ref<AppointmentRow[]>([])
const teamMembers = ref<TeamMemberRow[]>([])
// A long day is shown fifty rows at a time.
const PAGE = 50
const visible = ref(PAGE)
// Stored keys are not labels ("transfer", "write_off").
const { ensureLoaded: ensurePaymentMethodsLoaded, labelFor: labelForMethod } = usePaymentMethods()
// What the money was for, beside how it arrived.
const { purposeLabelFor } = usePaymentPurpose()

function shiftDay(days: number) {
  const d = new Date(`${dateStr.value}T00:00:00`)
  d.setDate(d.getDate() + days)
  dateStr.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A day picked while this is in flight starts another run; only the latest
// may write, or stepping through days quickly shows one day's rows under
// another's date.
let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  failed.value = false
  const { from, to } = rangeBounds({ from: dateStr.value, to: dateStr.value })

  // One request. Each payment carries the invoice it settles (its number, and
  // through it the appointment, which is whose money it is) and the patient
  // it was taken from. Patients come off the payments, not off the invoices
  // they settle: half the rows settle no invoice at all.
  //
  // The practitioner comes from the invoice's linked appointment, same as
  // reports/income -- neither payments nor invoices carry the column directly.
  type DayPaymentRow = Omit<PaymentRow, 'invoices'> & {
    invoices: (InvoiceRow & { status: string; appointments: AppointmentRow | null }) | null
    patients: PatientRow | null
  }
  const { data: p, error } = (await supabase
    .from('payments')
    .select(
      'id, amount_cents, method, paid_at, patient_id, purpose, invoice_id, invoices!payments_invoice_id_fkey(status, id, invoice_number, patient_id, is_refund, appointment_id, appointments!invoices_appointment_id_fkey(id, practitioner_id, clinic_id)), patients!payments_patient_id_fkey(id, first_name, last_name, default_practitioner_id, clinic_id)',
    )
    .gte('paid_at', from.toISOString())
    .lte('paid_at', to.toISOString())
    .order('paid_at')) as unknown as { data: DayPaymentRow[] | null; error: unknown }
  if (mine !== run) return
  if (error) {
    failed.value = true
    loading.value = false
    return
  }
  // The void rule is applied here rather than in the query since the join is
  // a left one: a payment with no invoice has nothing to void and must survive.
  const kept = (p ?? []).filter((row) => row.invoices?.status !== 'void')
  const dayPayments: PaymentRow[] = kept.map(({ invoices: invoice, patients: _patient, ...row }) => ({ ...row, invoices: invoice ? { status: invoice.status } : null }))
  const invoiceMap = new Map<string, InvoiceRow>()
  const appointmentMap = new Map<string, AppointmentRow>()
  const patientMap = new Map<string, PatientRow>()
  for (const row of kept) {
    if (row.invoices) {
      const { appointments: appointment, status: _status, ...invoice } = row.invoices
      invoiceMap.set(invoice.id, invoice)
      if (appointment) appointmentMap.set(appointment.id, appointment)
    }
    if (row.patients) patientMap.set(row.patients.id, row.patients)
  }
  payments.value = dayPayments
  invoices.value = [...invoiceMap.values()]
  appointments.value = [...appointmentMap.values()]
  patients.value = [...patientMap.values()]
  visible.value = PAGE
  loading.value = false
}

// Only once the role is known to include it: a refused read would come back
// empty and read as "nothing taken today".
watch(
  () => !!context.value && canOpen(PATH),
  (ok) => {
    if (!ok) return
    load()
    loadFilterOptions()
    ensurePaymentMethodsLoaded()
    supabase.from('team_members').select('id, full_name').then(({ data }) => { teamMembers.value = data ?? [] })
  },
  { immediate: true },
)
// Only the day refetches. The practitioner and clinic filters are applied by
// filteredPayments below, against maps load() has already built.
watch(dateStr, () => { if (context.value && canOpen(PATH)) load() })

const invoiceById = computed(() => new Map(invoices.value.map((row) => [row.id, row])))
const patientById = computed(() => new Map(patients.value.map((row) => [row.id, row])))
const appointmentById = computed(() => new Map(appointments.value.map((row) => [row.id, row])))
const memberById = computed(() => new Map(teamMembers.value.map((row) => [row.id, row.full_name])))

function invoiceFor(payment: PaymentRow) {
  return payment.invoice_id ? invoiceById.value.get(payment.invoice_id) : undefined
}
function apptFor(payment: PaymentRow) {
  const invoice = invoiceFor(payment)
  return invoice?.appointment_id ? appointmentById.value.get(invoice.appointment_id) : undefined
}
// The same rule reports/income filters by: a bono or refund with no visit
// still belongs to the patient's own practitioner, rather than vanishing from
// a filtered day sheet.
const filteredPayments = computed(() =>
  payments.value.filter(
    (row) =>
      classifyPaymentForFilter({
        practitionerId: practitionerFilter.value || undefined,
        clinicId: clinicFilter.value || undefined,
        appointment: apptFor(row) ?? null,
        patient: patientById.value.get(row.patient_id) ?? null,
      }) === 'matches',
  ),
)

// payments.patient_id is not null, so the only way this misses is a patient
// row the reader cannot see (a practitioner scoped to their own patients
// reading a colleague's takings). That is what "Unknown" is for.
function patientName(patientId: string) {
  const p = patientById.value.get(patientId)
  return p ? `${p.first_name} ${p.last_name ?? ''}`.trim() : t('Unknown', 'Desconocido')
}
// Whose money this is, by the same chain Income answers with: the visit when
// there is one, the patient's own practitioner when there is not. An
// attribution, not a record of who performed the visit -- the trade Income
// already made.
function practitionerName(payment: PaymentRow) {
  const practitionerId = practitionerForPayment({
    appointment: apptFor(payment) ?? null,
    patient: patientById.value.get(payment.patient_id) ?? null,
  })
  return practitionerId ? (memberById.value.get(practitionerId) ?? t('Unknown', 'Desconocido')) : t('Unassigned', 'Sin asignar')
}
function time(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// This is read at the end of the day against what is in the drawer and what
// the card terminal says, so it counts only what arrived -- see
// utils/paymentReceipts. Credit spent today is listed, because it happened
// and staff will look for it, and totalled separately so the rows still add
// up to the cards.
const receipts = computed(() => filteredPayments.value.filter((row) => isReceipt(row.method)))
const netCents = computed(() => receipts.value.reduce((sum, row) => sum + row.amount_cents, 0))
const creditAppliedCents = computed(() => filteredPayments.value.filter((row) => row.method === 'credit').reduce((sum, row) => sum + row.amount_cents, 0))
const byMethod = computed(() => {
  const totals = new Map<string, number>()
  for (const row of receipts.value) totals.set(row.method, (totals.get(row.method) ?? 0) + row.amount_cents)
  return [...totals.entries()].map(([method, cents]) => ({ method, cents })).sort((a, b) => b.cents - a.cents)
})

function detail(row: PaymentRow) {
  const invoice = invoiceFor(row)
  const parts = [time(row.paid_at), labelForMethod(row.method)]
  const purpose = purposeLabelFor(row.purpose)
  if (purpose) parts.push(purpose)
  parts.push(practitionerName(row))
  if (invoice) parts.push(invoice.is_refund ? `${invoice.invoice_number} (${t('refund', 'reembolso')})` : invoice.invoice_number)
  return parts.join(' · ')
}

const locale = computed(() => t('en-GB', 'es-ES'))
const isToday = computed(() => dateStr.value === todayISO())
const dayLabel = computed(() => {
  const s = new Date(`${dateStr.value}T00:00:00`).toLocaleDateString(locale.value, { weekday: 'short', day: 'numeric', month: 'short' })
  return isToday.value ? `${t('Today', 'Hoy')} · ${s}` : s
})
</script>

<template>
  <ReportScreen :title="t('Daily Transactions', 'Transacciones del día')" path="/reports/daily-transactions" :description="t('Every payment and refund recorded on a given day, for end-of-day cash reconciliation.', 'Todos los pagos y reembolsos registrados en un día, para el cuadre de caja.')">
    <template #filters>
      <div class="flex h-9 shrink-0 items-center rounded-full border border-line-control bg-surface" data-cy="report-daily-transactions-day">
        <button type="button" class="flex h-9 w-11 items-center justify-center text-ink-muted" :aria-label="t('Previous day', 'Día anterior')" data-cy="report-daily-transactions-prev" @click="shiftDay(-1)"><AppChevron dir="left" :size="16" /></button>
        <label class="relative flex h-full items-center whitespace-nowrap px-1 text-[13px] font-semibold text-ink-700">
          {{ dayLabel }}
          <input v-model="dateStr" type="date" :aria-label="t('Day', 'Día')" class="absolute inset-0 h-full w-full cursor-pointer opacity-0" data-cy="report-daily-transactions-date" />
        </label>
        <button type="button" class="flex h-9 w-11 items-center justify-center text-ink-muted" :aria-label="t('Next day', 'Día siguiente')" data-cy="report-daily-transactions-next" @click="shiftDay(1)"><AppChevron dir="right" :size="16" /></button>
      </div>
      <button v-if="!isToday" type="button" class="h-9 shrink-0 rounded-full border border-line-control bg-surface px-3 text-[13px] font-semibold text-ink-700" @click="dateStr = todayISO()">
        {{ t('Today', 'Hoy') }}
      </button>
      <ReportPeopleFilters v-model:practitioner-id="practitionerFilter" v-model:clinic-id="clinicFilter" :locked-to="reportsPractitionerId" :practitioners="practitioners" :clinics="clinics" />
    </template>

    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
      <ReportsStat :label="t('Net collected', 'Neto cobrado')" :loading="loading" class="col-span-2 md:col-span-1">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-daily-transactions-net">{{ formatEur(netCents) }}</p>
      </ReportsStat>
      <template v-if="!loading">
        <ReportsStat v-for="row in byMethod" :key="row.method" :label="labelForMethod(row.method)">
          <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-daily-transactions-method">{{ formatEur(row.cents) }}</p>
        </ReportsStat>
        <!-- Deliberately outside "Net collected": this money was collected on
        whatever day the patient paid it in, and counting it again here would
        make the day's takings disagree with the drawer. -->
        <div v-if="creditAppliedCents > 0" class="rounded-card border border-dashed border-line-control bg-surface p-4 shadow-card">
          <p class="text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Credit applied', 'Crédito aplicado') }}</p>
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-muted2">{{ formatEur(creditAppliedCents) }}</p>
          <p class="mt-1 text-[11px] text-ink-faint2">{{ t('Not money in today', 'No es dinero que entra hoy') }}</p>
        </div>
      </template>
    </div>

    <ReportsModule :title="t('Transactions', 'Transacciones')" :loading="loading" skeleton="list" :rows="5">
      <p v-if="filteredPayments.length === 0" class="py-4 text-center text-[13.5px] text-ink-faint">{{ t('No transactions on this day.', 'Sin transacciones este día.') }}</p>
      <template v-else>
        <ul class="mt-1" data-cy="report-daily-transactions-list">
          <ReportRow
            v-for="row in filteredPayments.slice(0, visible)"
            :key="row.id"
            :to="`/patients/${row.patient_id}`"
            :title="shown(patientName(row.patient_id))"
            :subtitle="detail(row)"
            :value="formatEur(row.amount_cents)"
            :tone="row.amount_cents < 0 ? 'danger' : row.method === 'credit' ? 'muted' : 'default'"
          />
        </ul>
        <AppButton v-if="filteredPayments.length > visible" class="mt-2 w-full" data-cy="report-daily-transactions-more" @click="visible += PAGE">
          {{ t(`Show more (${filteredPayments.length - visible})`, `Ver más (${filteredPayments.length - visible})`) }}
        </AppButton>
      </template>
    </ReportsModule>
  </ReportScreen>
</template>
