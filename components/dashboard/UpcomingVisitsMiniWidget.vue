<script setup lang="ts">
defineProps<{ dateRange?: unknown; practitionerId?: string; clinicId?: string }>()

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
  <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
  <div v-else class="grid grid-cols-3 gap-2 text-center text-sm">
    <div>
      <p class="text-lg font-semibold text-gray-900">{{ totalCount }}</p>
      <p class="text-xs text-gray-500">This month</p>
    </div>
    <div>
      <p class="text-lg font-semibold" :class="changePct !== null && changePct < 0 ? 'text-red-600' : 'text-green-600'">
        {{ changePct === null ? '—' : `${changePct > 0 ? '+' : ''}${changePct}%` }}
      </p>
      <p class="text-xs text-gray-500">vs. last month</p>
    </div>
    <div>
      <p class="text-lg font-semibold text-gray-900">{{ dailyAvg.toFixed(1) }}</p>
      <p class="text-xs text-gray-500">Daily avg</p>
    </div>
  </div>
</template>
