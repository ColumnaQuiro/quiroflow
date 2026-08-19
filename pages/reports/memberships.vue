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
  <div>
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">Memberships</h1>
      <NuxtLink to="/reports" class="text-sm text-gray-500 hover:text-gray-700">&larr; Reports</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">Active memberships, monthly revenue, and failed payments — manual and Stripe autopay combined.</p>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>
    <template v-else>
      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold text-gray-900">{{ active.length }}</p>
          <p class="text-xs text-gray-500">Active memberships</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold text-gray-900">€{{ (monthlyRevenue / 100).toFixed(2) }}</p>
          <p class="text-xs text-gray-500">Revenue this month (paid)</p>
        </div>
        <div class="rounded-lg border border-gray-200 bg-white p-4">
          <p class="text-2xl font-semibold" :class="failedPayments.length > 0 ? 'text-red-600' : 'text-gray-900'">{{ failedPayments.length }}</p>
          <p class="text-xs text-gray-500">Failed payments (all time)</p>
        </div>
      </div>

      <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table class="w-full text-sm">
          <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th class="px-4 py-2">Patient</th>
              <th class="px-4 py-2">Plan</th>
              <th class="px-4 py-2">Status</th>
              <th class="px-4 py-2">Started</th>
              <th class="px-4 py-2">Last payment</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-if="memberships.length === 0">
              <td colspan="5" class="px-4 py-6 text-center text-gray-400">No memberships yet.</td>
            </tr>
            <tr v-for="m in memberships" :key="m.id">
              <td class="px-4 py-2.5 text-gray-900">
                <NuxtLink :to="`/patients/${m.patient_id}`" class="hover:text-indigo-600">{{ patientName(m.patient_id) }}</NuxtLink>
              </td>
              <td class="px-4 py-2.5 text-gray-500">{{ m.membership_name }}</td>
              <td class="px-4 py-2.5">
                <span
                  class="rounded px-1.5 py-0.5 text-xs font-medium"
                  :class="{ active: 'bg-green-50 text-green-700', paused: 'bg-amber-50 text-amber-700', cancelled: 'bg-gray-100 text-gray-500' }[m.status]"
                >
                  {{ m.status }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-gray-500">{{ new Date(m.started_at).toLocaleDateString() }}</td>
              <td class="px-4 py-2.5">
                <span v-if="lastPayment(m.id)" class="rounded px-1.5 py-0.5 text-xs font-medium" :class="lastPayment(m.id)!.status === 'paid' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'">
                  {{ lastPayment(m.id)!.period_start }}: {{ lastPayment(m.id)!.status }}
                </span>
                <span v-else class="text-xs text-gray-400">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
