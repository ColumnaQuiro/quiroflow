<script setup lang="ts">
const props = defineProps<{ practitionerId?: string; clinicId?: string }>()

const t = useT()
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
      const name = appt.appointment_types?.name ?? t('No type', 'Sin tipo')
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
  <div v-if="loading" class="space-y-2">
    <div v-for="i in 5" :key="i" class="flex items-center justify-between py-1.5">
      <UiSkeleton class="h-3 w-28 rounded-ctlSm" />
      <UiSkeleton class="h-3 w-10 rounded-ctlSm" />
    </div>
  </div>
  <div v-else>
    <ul class="divide-y divide-line-row2 text-[13px]">
      <li class="flex items-center justify-between py-1.5">
        <span class="text-ink-700">{{ t('Remaining visits', 'Visitas restantes') }}</span>
        <span class="font-mono text-[12.5px] text-ink-900">{{ remaining }}</span>
      </li>
      <li class="flex items-center justify-between py-1.5">
        <span class="text-ink-700">{{ t('Estimated visits', 'Visitas estimadas') }}</span>
        <span class="font-mono text-[12.5px] text-ink-900">{{ estimated }}</span>
      </li>
      <li class="flex items-center justify-between py-1.5">
        <span class="text-ink-700">{{ t('Payments this week', 'Pagos esta semana') }}</span>
        <span class="font-mono text-[12.5px] text-ink-900">{{ euros(paymentsCents) }}</span>
      </li>
      <li class="flex items-center justify-between py-1.5">
        <span class="text-ink-700">{{ t('Service generated', 'Servicio generado') }}</span>
        <span class="font-mono text-[12.5px] text-ink-900">{{ euros(serviceCents) }}</span>
      </li>
      <li class="flex items-center justify-between py-1.5">
        <span class="text-ink-700">{{ t('Cancellations', 'Cancelaciones') }}</span>
        <span class="font-mono text-[12.5px]" :class="cancellations > 0 ? 'text-danger-text' : 'text-ink-900'">{{ cancellations }}</span>
      </li>
    </ul>
    <div v-if="byType.length > 0" class="mt-2 border-t border-line-row2 pt-2">
      <p class="mb-1 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ t('By type', 'Por tipo') }}</p>
      <div v-for="bt in byType" :key="bt.name" class="flex items-center justify-between py-0.5 text-[12.5px]">
        <span class="text-ink-muted2">{{ bt.name }}</span>
        <span class="font-mono text-ink-600">{{ bt.count }}</span>
      </div>
    </div>
  </div>
</template>
