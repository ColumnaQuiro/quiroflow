<script setup lang="ts">
const props = defineProps<{ practitionerId?: string; clinicId?: string }>()

const supabase = useSupabaseClient()
const loading = ref(true)

interface TypeCount { name: string; count: number }
const byType = ref<TypeCount[]>([])
const remaining = ref(0)
const estimated = ref(0)
const cancellations = ref(0)
const paymentsCents = ref(0)
const serviceCents = ref(0)

async function load() {
  loading.value = true
  const { from, to } = getWeekRange()
  const { from: fromDate, to: toDate } = rangeBounds({ from, to })
  const now = new Date()

  let apptQuery = supabase
    .from('appointments')
    .select('id, status, starts_at, appointment_types(name)')
    .gte('starts_at', fromDate.toISOString())
    .lte('starts_at', toDate.toISOString())
  if (props.practitionerId) apptQuery = apptQuery.eq('practitioner_id', props.practitionerId)
  if (props.clinicId) apptQuery = apptQuery.eq('clinic_id', props.clinicId)

  const appointments = await fetchAllRows((f, t) => apptQuery.range(f, t))

  const typeCounts = new Map<string, number>()
  let remainingCount = 0
  let estimatedCount = 0
  let cancelledCount = 0
  for (const appt of appointments as unknown as { status: string; starts_at: string; appointment_types: { name: string } | null }[]) {
    if (appt.status === 'cancelled') cancelledCount++
    if (appt.status === 'booked' || appt.status === 'completed') estimatedCount++
    if (appt.status === 'booked' && new Date(appt.starts_at) > now) remainingCount++
    if (appt.status === 'completed') {
      const name = appt.appointment_types?.name ?? 'No type'
      typeCounts.set(name, (typeCounts.get(name) ?? 0) + 1)
    }
  }
  byType.value = [...typeCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  remaining.value = remainingCount
  estimated.value = estimatedCount
  cancellations.value = cancelledCount

  const { data: payments } = await supabase
    .from('payments')
    .select('amount_cents')
    .gte('paid_at', fromDate.toISOString())
    .lte('paid_at', toDate.toISOString())
  paymentsCents.value = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)

  const { data: invoicesThisWeek } = await supabase
    .from('invoices')
    .select('id')
    .gte('created_at', fromDate.toISOString())
    .lte('created_at', toDate.toISOString())
  const invoiceIds = (invoicesThisWeek ?? []).map((i) => i.id)
  if (invoiceIds.length > 0) {
    const { data: lines } = await supabase.from('invoice_line_items').select('price_cents, quantity').in('invoice_id', invoiceIds)
    serviceCents.value = (lines ?? []).reduce((sum, l) => sum + l.price_cents * l.quantity, 0)
  } else {
    serviceCents.value = 0
  }

  loading.value = false
}
onMounted(load)
watch(() => [props.practitionerId, props.clinicId], load)

function euros(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
  <div v-else class="space-y-3 text-sm">
    <div>
      <p class="text-xs font-medium uppercase tracking-wide text-gray-400">Patients seen by type</p>
      <p v-if="byType.length === 0" class="mt-1 text-gray-400">None yet</p>
      <ul v-else class="mt-1 space-y-0.5">
        <li v-for="t in byType" :key="t.name" class="flex justify-between text-gray-700">
          <span>{{ t.name }}</span>
          <span class="font-medium text-gray-900">{{ t.count }}</span>
        </li>
      </ul>
    </div>
    <div class="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gray-100 pt-3">
      <div>
        <p class="text-xs text-gray-500">Remaining visits</p>
        <p class="font-semibold text-gray-900">{{ remaining }}</p>
      </div>
      <div>
        <p class="text-xs text-gray-500">Estimated visits</p>
        <p class="font-semibold text-gray-900">{{ estimated }}</p>
      </div>
      <div>
        <p class="text-xs text-gray-500">Payments this week</p>
        <p class="font-semibold text-gray-900">{{ euros(paymentsCents) }}</p>
      </div>
      <div>
        <p class="text-xs text-gray-500">Service generated</p>
        <p class="font-semibold text-gray-900">{{ euros(serviceCents) }}</p>
      </div>
      <div>
        <p class="text-xs text-gray-500">Cancellations</p>
        <p class="font-semibold text-red-600">{{ cancellations }}</p>
      </div>
    </div>
  </div>
</template>
