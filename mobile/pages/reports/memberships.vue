<script setup lang="ts">
// Membresías, on the phone: the web's pages/reports/memberships.vue, from the
// same single read (each membership with its patient, its manual payments and
// its Stripe schedule's charges) and the same three figures, so the counts
// here are the web's. Reshaped for a phone: the five-column table is a list
// (patient, plan and start date on the left; status and the last payment
// under them), fifty at a time. Left out: the PDF button (no PDF on the app
// yet).
import { formatEur } from '../../../utils/billing'

definePageMeta({ layout: 'practitioner' })

interface MembershipRow {
  id: string
  patient_id: string
  membership_name: string
  price_cents: number
  status: string
  started_at: string
}
interface PaymentRow {
  id: string
  patient_membership_id: string
  period_start: string
  amount_cents: number
  status: string
}
interface PatientRow { id: string; first_name: string; last_name: string }

const PATH = '/reports/memberships'
const supabase = useSupabaseClient()
const t = useT()
const { canOpen, context } = useReportAccess()
const { shown } = usePrivacyMode()
const loading = ref(true)
const failed = ref(false)
const memberships = ref<MembershipRow[]>([])
const payments = ref<PaymentRow[]>([])
const patientsById = ref<Map<string, PatientRow>>(new Map())
const PAGE = 50
const visible = ref(PAGE)

async function load() {
  loading.value = true
  failed.value = false
  // One request: each membership with its patient, its own payments and its
  // Stripe schedule's charges.
  type Row = MembershipRow & {
    patients: PatientRow | null
    membership_payments: PaymentRow[]
    payment_schedules: { id: string; patient_membership_id: string | null; stripe_payment_events: { id: string; payment_schedule_id: string; period_start: string; amount_cents: number; status: string }[] }[]
  }
  const { data, error } = await supabase
    .from('patient_memberships')
    .select(
      'id, patient_id, membership_name, price_cents, status, started_at, patients!patient_memberships_patient_id_fkey(id, first_name, last_name), membership_payments(id, patient_membership_id, period_start, amount_cents, status), payment_schedules!payment_schedules_patient_membership_id_fkey(id, patient_membership_id, stripe_payment_events(id, payment_schedule_id, period_start, amount_cents, status))',
    )
    .order('started_at', { ascending: false })
  if (error) {
    failed.value = true
    loading.value = false
    return
  }
  const rows = (data ?? []) as unknown as Row[]
  memberships.value = rows.map(({ patients: _patient, membership_payments: _payments, payment_schedules: _schedules, ...m }) => m)
  patientsById.value = new Map(rows.filter((m) => m.patients).map((m) => [m.patients!.id, m.patients!]))

  const stripeAsPayments: PaymentRow[] = rows.flatMap((m) =>
    m.payment_schedules.flatMap((schedule) =>
      schedule.stripe_payment_events.map((e) => ({
        id: `stripe-${e.id}`,
        patient_membership_id: schedule.patient_membership_id ?? '',
        period_start: e.period_start,
        amount_cents: e.amount_cents,
        status: e.status,
      })),
    ),
  )
  payments.value = [...rows.flatMap((m) => m.membership_payments), ...stripeAsPayments]
  visible.value = PAGE
  loading.value = false
}
// Only once the role is known to include it: a refused read would come back
// empty and read as "no memberships".
watch(() => !!context.value && canOpen(PATH), (ok) => { if (ok) load() }, { immediate: true })

function patientName(id: string) {
  const p = patientsById.value.get(id)
  return p ? `${p.first_name} ${p.last_name}` : '—'
}

const active = computed(() => memberships.value.filter((m) => m.status === 'active'))
const thisMonthKey = new Date().toISOString().slice(0, 7)
const monthlyRevenue = computed(() =>
  payments.value.filter((p) => p.status === 'paid' && p.period_start.slice(0, 7) === thisMonthKey).reduce((sum, p) => sum + p.amount_cents, 0),
)
const failedPayments = computed(() => payments.value.filter((p) => p.status === 'failed'))

const lastPaymentById = computed(() => {
  const out = new Map<string, PaymentRow>()
  for (const p of payments.value) {
    const prev = out.get(p.patient_membership_id)
    if (!prev || p.period_start.localeCompare(prev.period_start) > 0) out.set(p.patient_membership_id, p)
  }
  return out
})

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = { active: 'success', paused: 'warning', cancelled: 'neutral' }
function statusLabel(s: string) {
  if (s === 'active') return t('active', 'activa')
  if (s === 'paused') return t('paused', 'pausada')
  if (s === 'cancelled') return t('cancelled', 'cancelada')
  return s
}
function paymentLabel(s: string) {
  if (s === 'paid') return t('paid', 'pagado')
  if (s === 'failed') return t('failed', 'fallido')
  return s
}
const locale = computed(() => t('en-GB', 'es-ES'))
const date = (iso: string) => new Date(iso).toLocaleDateString(locale.value, { day: 'numeric', month: 'short', year: 'numeric' })
</script>

<template>
  <ReportScreen :title="t('Memberships', 'Membresías')" path="/reports/memberships" :description="t('Active count, monthly revenue, and failed payments. Manual and Stripe autopay combined.', 'Recuento activo, ingresos mensuales y pagos fallidos. Combina pagos manuales y cobro automático de Stripe.')">
    <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert">
      {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
      <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
      <ReportsStat :label="t('Active memberships', 'Membresías activas')" :loading="loading">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-memberships-active">{{ active.length }}</p>
      </ReportsStat>
      <ReportsStat :label="t('Failed payments (all time)', 'Pagos fallidos (histórico)')" :loading="loading">
        <p class="font-mono text-[23px] font-semibold" :class="failedPayments.length > 0 ? 'text-danger-text' : 'text-ink-900'" data-cy="report-memberships-failed">{{ failedPayments.length }}</p>
      </ReportsStat>
      <ReportsStat :label="t('Revenue this month (paid)', 'Ingresos este mes (pagado)')" :loading="loading" class="col-span-2 md:col-span-1">
        <p class="font-mono text-[23px] font-semibold text-ink-900" data-cy="report-memberships-revenue">{{ formatEur(monthlyRevenue) }}</p>
      </ReportsStat>
    </div>

    <ReportsModule :title="t('Memberships', 'Membresías')" :loading="loading" skeleton="list" :rows="6">
      <p v-if="memberships.length === 0" class="py-4 text-center text-[13.5px] text-ink-faint">{{ t('No memberships yet.', 'Todavía no hay membresías.') }}</p>
      <template v-else>
        <ul class="mt-1" data-cy="report-memberships-list">
          <ReportRow
            v-for="m in memberships.slice(0, visible)"
            :key="m.id"
            :to="`/patients/${m.patient_id}`"
            :title="shown(patientName(m.patient_id))"
            :subtitle="`${m.membership_name} · ${t('since', 'desde')} ${date(m.started_at)}`"
          >
            <span class="mt-1 flex flex-wrap items-center gap-1.5">
              <UiPill :tone="STATUS_TONE[m.status] ?? 'neutral'">{{ statusLabel(m.status) }}</UiPill>
              <UiPill v-if="lastPaymentById.get(m.id)" :tone="lastPaymentById.get(m.id)!.status === 'paid' ? 'success' : 'danger'">
                {{ t('Last payment', 'Último pago') }} {{ lastPaymentById.get(m.id)!.period_start }}: {{ paymentLabel(lastPaymentById.get(m.id)!.status) }}
              </UiPill>
              <span v-else class="text-[11.5px] text-ink-faint">{{ t('No payments yet', 'Sin pagos aún') }}</span>
            </span>
          </ReportRow>
        </ul>
        <AppButton v-if="memberships.length > visible" class="mt-2 w-full" data-cy="report-memberships-more" @click="visible += PAGE">
          {{ t(`Show more (${memberships.length - visible})`, `Ver más (${memberships.length - visible})`) }}
        </AppButton>
      </template>
    </ReportsModule>
  </ReportScreen>
</template>
