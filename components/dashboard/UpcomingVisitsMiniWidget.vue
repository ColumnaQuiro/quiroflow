<script setup lang="ts">
defineProps<{ dateRange?: unknown; practitionerId?: string; clinicId?: string }>()

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const totalCount = ref(0)
const changePct = ref<number | null>(null)
const dailyAvg = ref(0)

function monthStart(offset: number) {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  d.setMonth(d.getMonth() + offset)
  return d
}
function addMonths(d: Date, n: number) {
  const c = new Date(d)
  c.setMonth(c.getMonth() + n)
  return c
}
function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

onMounted(async () => {
  loading.value = true
  const rangeStart = monthStart(0)
  const rangeEnd = addMonths(rangeStart, 1)
  const prevStart = addMonths(rangeStart, -1)

  const [{ count: current }, { count: prevCount }] = await Promise.all([
    supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('starts_at', rangeStart.toISOString()).lt('starts_at', rangeEnd.toISOString()),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('starts_at', prevStart.toISOString()).lt('starts_at', rangeStart.toISOString()),
  ])

  totalCount.value = current ?? 0
  changePct.value = !prevCount ? null : Math.round(((totalCount.value - prevCount) / prevCount) * 100)
  dailyAvg.value = totalCount.value / daysInMonth(rangeStart)
  loading.value = false
})
</script>

<template>
  <div v-if="loading" class="text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
  <ul v-else class="divide-y divide-line-row2 text-[13px]">
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('This month', 'Este mes') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ totalCount }}</span>
    </li>
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('vs. last month', 'frente al mes pasado') }}</span>
      <span class="font-mono text-[12.5px]" :class="changePct !== null && changePct < 0 ? 'text-danger-text' : 'text-success-text'">
        {{ changePct === null ? '—' : `${changePct > 0 ? '+' : ''}${changePct}%` }}
      </span>
    </li>
    <li class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ t('Daily average', 'Media diaria') }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ dailyAvg.toFixed(1) }}</span>
    </li>
  </ul>
</template>
