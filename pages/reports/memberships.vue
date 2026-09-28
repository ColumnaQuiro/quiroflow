<script setup lang="ts">
import { formatEur } from '~/utils/billing'
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

const supabase = useSupabaseClient()
const t = useT()
const loading = ref(true)
const memberships = ref<MembershipRow[]>([])
const payments = ref<PaymentRow[]>([])
const patientsById = ref<Map<string, PatientRow>>(new Map())

onMounted(async () => {
  // One request: each membership with its patient, its own payments and its
  // Stripe schedule's charges. These were four more rounds after the
  // memberships had loaded -- payments, patients and schedules by membership
  // id, then the charges by schedule id -- each chunked into the URL.
  type Row = MembershipRow & {
    patients: PatientRow | null
    membership_payments: PaymentRow[]
    payment_schedules: { id: string; patient_membership_id: string | null; stripe_payment_events: { id: string; payment_schedule_id: string; period_start: string; amount_cents: number; status: string }[] }[]
  }
  const { data } = await supabase
    .from('patient_memberships')
    .select(
      'id, patient_id, membership_name, price_cents, status, started_at, patients!patient_memberships_patient_id_fkey(id, first_name, last_name), membership_payments(id, patient_membership_id, period_start, amount_cents, status), payment_schedules!payment_schedules_patient_membership_id_fkey(id, patient_membership_id, stripe_payment_events(id, payment_schedule_id, period_start, amount_cents, status))',
    )
    .order('started_at', { ascending: false })
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

  loading.value = false
})

// The three headline figures. Their labels are on screen from the first
// paint; only the numbers wait for the data.
const tiles = computed(() => [
  { key: 'active', label: t('Active memberships', 'Membresías activas'), value: String(active.value.length), danger: false },
  { key: 'revenue', label: t('Revenue this month (paid)', 'Ingresos este mes (pagado)'), value: formatEur(monthlyRevenue.value), danger: false },
  { key: 'failed', label: t('Failed payments (all time)', 'Pagos fallidos (histórico)'), value: String(failedPayments.value.length), danger: failedPayments.value.length > 0 },
])

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

function lastPayment(membershipId: string) {
  return payments.value
    .filter((p) => p.patient_membership_id === membershipId)
    .sort((a, b) => b.period_start.localeCompare(a.period_start))[0]
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Memberships', 'Membresías')" :meta="t('Active count, monthly revenue, and failed payments', 'Recuento activo, ingresos mensuales y pagos fallidos')">
      <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-6 pb-10 pt-[18px]">
      <p class="text-[13px] text-ink-muted2">{{ t('Manual and Stripe autopay combined.', 'Combina pagos manuales y cobro automático de Stripe.') }}</p>

      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div v-for="tile in tiles" :key="tile.key" class="rounded-card border border-line bg-surface p-4 shadow-card" :aria-busy="loading || undefined">
          <div v-if="loading" class="flex items-center font-mono text-[23px]" aria-hidden="true">&#8203;<UiSkeleton class="h-[23px] w-16 rounded-ctlSm" /></div>
          <p v-else class="font-mono text-[23px] font-semibold" :class="tile.danger ? 'text-danger-text' : 'text-ink-900'">{{ tile.value }}</p>
          <p class="text-[12px] text-ink-muted2">{{ tile.label }}</p>
        </div>
      </div>

      <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <table class="w-full text-[13px]">
          <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">
            <tr>
              <th class="px-4 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-4 py-2">{{ t('Plan', 'Plan') }}</th>
              <th class="px-4 py-2">{{ t('Status', 'Estado') }}</th>
              <th class="px-4 py-2">{{ t('Started', 'Inicio') }}</th>
              <th class="px-4 py-2">{{ t('Last payment', 'Último pago') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-row">
            <ReportsTableSkeletonRows v-if="loading" :cols="5" />
            <tr v-else-if="memberships.length === 0">
              <td colspan="5" class="px-4 py-6 text-center text-ink-faint2">{{ t('No memberships yet.', 'Todavía no hay membresías.') }}</td>
            </tr>
            <tr v-for="m in loading ? [] : memberships" :key="m.id">
              <td class="px-4 py-2.5 text-ink-900">
                <NuxtLink :to="`/patients/${m.patient_id}`" class="hover:text-brand-text">{{ patientName(m.patient_id) }}</NuxtLink>
              </td>
              <td class="px-4 py-2.5 text-ink-muted2">{{ m.membership_name }}</td>
              <td class="px-4 py-2.5">
                <span
                  class="rounded-pill px-1.5 py-0.5 text-[11px] font-medium"
                  :class="{ active: 'bg-success-bg text-success-text', paused: 'bg-warning-bg text-warning-text', cancelled: 'bg-chip-bg text-chip-text' }[m.status]"
                >
                  {{ m.status }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-ink-muted2">{{ new Date(m.started_at).toLocaleDateString() }}</td>
              <td class="px-4 py-2.5">
                <span v-if="lastPayment(m.id)" class="rounded-pill px-1.5 py-0.5 text-[11px] font-medium" :class="lastPayment(m.id)!.status === 'paid' ? 'bg-success-bg text-success-text' : 'bg-danger-bg text-danger-text'">
                  {{ lastPayment(m.id)!.period_start }}: {{ lastPayment(m.id)!.status }}
                </span>
                <span v-else class="text-[12px] text-ink-faint2">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
