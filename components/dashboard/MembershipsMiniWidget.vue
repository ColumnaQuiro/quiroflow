<script setup lang="ts">
import { formatEur } from '~/utils/billing'
// eslint-disable-next-line no-unused-vars -- accepted for a consistent generic widget prop shape, not used here (source report has no filters)
defineProps<{ dateRange?: unknown; practitionerId?: string; clinicId?: string }>()

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const activeCount = ref(0)
const monthlyRevenue = ref(0)
const failedCount = ref(0)

// Counted in the database: every membership with its payments and its Stripe
// schedule's charges used to come across, unpaged, to produce three numbers.
// The month is still the browser's UTC 'YYYY-MM', matched against each
// charge's period_start as before.
onMounted(async () => {
  const thisMonthKey = new Date().toISOString().slice(0, 7)
  const { data } = await supabase.rpc('dashboard_membership_summary', { p_month: thisMonthKey }).maybeSingle()
  activeCount.value = data?.active_count ?? 0
  monthlyRevenue.value = data?.revenue_cents ?? 0
  failedCount.value = data?.failed_count ?? 0
  loading.value = false
})
</script>

<template>
  <div v-if="loading" class="space-y-2">
    <div v-for="i in 3" :key="i" class="flex items-center justify-between py-1.5">
      <UiSkeleton class="h-3 w-28 rounded-ctlSm" />
      <UiSkeleton class="h-3 w-8 rounded-ctlSm" />
    </div>
  </div>
  <ul v-else class="divide-y divide-line-row2 text-[13px]">
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('Active memberships', 'Suscripciones activas') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ activeCount }}</span>
    </li>
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('Revenue this month', 'Ingresos este mes') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ formatEur(monthlyRevenue) }}</span>
    </li>
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('Failed payments', 'Pagos fallidos') }}</span>
      <span class="font-mono text-[12.5px]" :class="failedCount > 0 ? 'text-danger-text' : 'text-ink-900'">{{ failedCount }}</span>
    </li>
  </ul>
</template>
