<script setup lang="ts">
// KPI: how many patients are currently due for a recall, backed by the same
// recall_candidates view the Recalls page and sidebar badge use.
const props = defineProps<{ practitionerId?: string }>()

interface RecallRow { days_since_last_appointment: number | null }

const supabase = useSupabaseClient()
const loading = ref(true)
const count = ref(0)
const avgDays = ref<number | null>(null)

async function load() {
  loading.value = true
  let query = supabase.from('recall_candidates').select('days_since_last_appointment')
  if (props.practitionerId) query = query.eq('default_practitioner_id', props.practitionerId)
  const rows = await fetchAllRows<RecallRow>((f, t) => query.range(f, t))
  count.value = rows.length
  const known = rows.map((r) => r.days_since_last_appointment).filter((d): d is number => d !== null)
  avgDays.value = known.length > 0 ? Math.round(known.reduce((sum, d) => sum + d, 0) / known.length) : null
  loading.value = false
}
onMounted(load)
watch(() => props.practitionerId, load)
</script>

<template>
  <div v-if="loading" class="text-[13px] text-ink-faint">Loading…</div>
  <div v-else>
    <p class="font-mono text-[27px] leading-none text-ink-900">{{ count }}</p>
    <p class="mt-1.5 text-[12px] text-ink-muted2">
      {{ avgDays !== null ? `Avg ${avgDays} days since last visit` : 'No patients overdue for recall' }}
    </p>
    <NuxtLink to="/recalls" class="mt-1.5 inline-block text-[12px] font-medium text-brand-text hover:text-brand-hover">View recalls →</NuxtLink>
  </div>
</template>
