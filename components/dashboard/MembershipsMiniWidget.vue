<script setup lang="ts">
// eslint-disable-next-line no-unused-vars -- accepted for a consistent generic widget prop shape, not used here (source report has no filters)
defineProps<{ dateRange?: unknown; practitionerId?: string; clinicId?: string }>()

interface MembershipRow { id: string; status: string }
interface PaymentRow { patient_membership_id: string; period_start: string; amount_cents: number; status: string }

const supabase = useSupabaseClient()
const loading = ref(true)
const memberships = ref<MembershipRow[]>([])
const payments = ref<PaymentRow[]>([])

onMounted(async () => {
  const { data: m } = await supabase.from('patient_memberships').select('id, status')
  memberships.value = m ?? []
  const ids = memberships.value.map((x) => x.id)

  const [{ data: p }, { data: schedules }] = await Promise.all([
    ids.length > 0
      ? supabase.from('membership_payments').select('patient_membership_id, period_start, amount_cents, status').in('patient_membership_id', ids)
      : Promise.resolve({ data: [] as PaymentRow[] }),
    ids.length > 0 ? supabase.from('payment_schedules').select('id, patient_membership_id').in('patient_membership_id', ids) : Promise.resolve({ data: [] }),
  ])
  const scheduleIds = (schedules ?? []).map((s: any) => s.id)
  const scheduleToMembership = new Map((schedules ?? []).map((s: any) => [s.id, s.patient_membership_id]))
  const { data: stripeEvents } =
    scheduleIds.length > 0
      ? await supabase.from('stripe_payment_events').select('payment_schedule_id, period_start, amount_cents, status').in('payment_schedule_id', scheduleIds)
      : { data: [] as any[] }
  const stripeAsPayments: PaymentRow[] = (stripeEvents ?? []).map((e) => ({
    patient_membership_id: scheduleToMembership.get(e.payment_schedule_id) ?? '',
    period_start: e.period_start,
    amount_cents: e.amount_cents,
    status: e.status,
  }))
  payments.value = [...(p ?? []), ...stripeAsPayments]
  loading.value = false
})

const active = computed(() => memberships.value.filter((m) => m.status === 'active'))
const thisMonthKey = new Date().toISOString().slice(0, 7)
const monthlyRevenue = computed(() =>
  payments.value.filter((p) => p.status === 'paid' && p.period_start.slice(0, 7) === thisMonthKey).reduce((sum, p) => sum + p.amount_cents, 0),
)
const failedPayments = computed(() => payments.value.filter((p) => p.status === 'failed'))
</script>

<template>
  <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
  <div v-else class="grid grid-cols-3 gap-2 text-center text-sm">
    <div>
      <p class="text-lg font-semibold text-gray-900">{{ active.length }}</p>
      <p class="text-xs text-gray-500">Active</p>
    </div>
    <div>
      <p class="text-lg font-semibold text-gray-900">€{{ (monthlyRevenue / 100).toFixed(2) }}</p>
      <p class="text-xs text-gray-500">This month</p>
    </div>
    <div>
      <p class="text-lg font-semibold" :class="failedPayments.length > 0 ? 'text-red-600' : 'text-gray-900'">{{ failedPayments.length }}</p>
      <p class="text-xs text-gray-500">Failed</p>
    </div>
  </div>
</template>
