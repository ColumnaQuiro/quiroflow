<script setup lang="ts">
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
  const { data: m } = await supabase
    .from('patient_memberships')
    .select('id, patient_id, membership_name, price_cents, status, started_at')
    .order('started_at', { ascending: false })
  memberships.value = m ?? []

  const ids = memberships.value.map((x) => x.id)
  const patientIds = [...new Set(memberships.value.map((x) => x.patient_id))]

  const [{ data: p }, { data: patients }, { data: schedules }] = await Promise.all([
    ids.length > 0
      ? supabase.from('membership_payments').select('id, patient_membership_id, period_start, amount_cents, status').in('patient_membership_id', ids)
      : Promise.resolve({ data: [] as PaymentRow[] }),
    patientIds.length > 0
      ? supabase.from('patients').select('id, first_name, last_name').in('id', patientIds)
      : Promise.resolve({ data: [] as PatientRow[] }),
    ids.length > 0
      ? supabase.from('payment_schedules').select('id, patient_membership_id').in('patient_membership_id', ids)
      : Promise.resolve({ data: [] as { id: string; patient_membership_id: string | null }[] }),
  ])
  patientsById.value = new Map((patients ?? []).map((pt) => [pt.id, pt as PatientRow]))

  const scheduleIds = (schedules ?? []).map((s) => s.id)
  const scheduleToMembership = new Map((schedules ?? []).map((s) => [s.id, s.patient_membership_id as string]))
  const { data: stripeEvents } =
    scheduleIds.length > 0
      ? await supabase.from('stripe_payment_events').select('id, payment_schedule_id, period_start, amount_cents, status').in('payment_schedule_id', scheduleIds)
      : { data: [] as { id: string; payment_schedule_id: string; period_start: string; amount_cents: number; status: string }[] }

  // Merge manual (membership_payments) and Stripe-collected (stripe_payment_events)
  // charges into one list so revenue/failure stats and the "last payment"
  // column don't need to know which billing path produced each row.
  const stripeAsPayments: PaymentRow[] = (stripeEvents ?? []).map((e) => ({
    id: `stripe-${e.id}`,
    patient_membership_id: scheduleToMembership.get(e.payment_schedule_id) ?? '',
    period_start: e.period_start,
    amount_cents: e.amount_cents,
    status: e.status,
  }))
  payments.value = [...(p ?? []), ...stripeAsPayments]

  loading.value = false
})

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

      <div v-if="loading">
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div v-for="i in 3" :key="i" class="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card">
            <UiSkeleton class="h-[23px] w-16 rounded-ctlSm" />
            <UiSkeleton class="h-3 w-32 rounded-ctlSm" />
          </div>
        </div>
        <div class="mt-4 space-y-3 overflow-hidden rounded-card border border-line bg-surface p-4 shadow-card">
          <UiSkeleton v-for="i in 4" :key="i" class="h-3.5 w-full rounded-ctlSm" />
        </div>
      </div>
      <template v-else>
        <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="font-mono text-[23px] font-semibold text-ink-900">{{ active.length }}</p>
            <p class="text-[12px] text-ink-muted2">{{ t('Active memberships', 'Membresías activas') }}</p>
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="font-mono text-[23px] font-semibold text-ink-900">€{{ (monthlyRevenue / 100).toFixed(2) }}</p>
            <p class="text-[12px] text-ink-muted2">{{ t('Revenue this month (paid)', 'Ingresos este mes (pagado)') }}</p>
          </div>
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="font-mono text-[23px] font-semibold" :class="failedPayments.length > 0 ? 'text-danger-text' : 'text-ink-900'">{{ failedPayments.length }}</p>
            <p class="text-[12px] text-ink-muted2">{{ t('Failed payments (all time)', 'Pagos fallidos (histórico)') }}</p>
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
              <tr v-if="memberships.length === 0">
                <td colspan="5" class="px-4 py-6 text-center text-ink-faint2">{{ t('No memberships yet.', 'Todavía no hay membresías.') }}</td>
              </tr>
              <tr v-for="m in memberships" :key="m.id">
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
      </template>
    </div>
  </div>
</template>
