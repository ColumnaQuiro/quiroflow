<script setup lang="ts">
// KPI: how many patients are currently due for a recall, backed by the same
// recall_candidates view the Recalls page and sidebar badge use -- and at the
// same 3 weeks the Recalls list opens with, so the number is the length of the
// list "View recalls" leads to. Without it the tile counted everyone lapsed at
// all, and read 1000 beside a sidebar saying 577.
const RECALL_AFTER_DAYS = 21
const props = defineProps<{ practitionerId?: string }>()

interface RecallRow { days_since_last_appointment: number | null }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const count = ref(0)
const avgDays = ref<number | null>(null)
const latest = useLatestRun()

async function load() {
  const isStale = latest.start()
  loading.value = true
  // A new query for every page. One builder shared by all of them is mutated
  // by each .range(), and fetchAllRows asks for pages 2-5 at once -- so all
  // four fetched the last range, came back empty, and a list longer than a
  // page was counted as exactly 1000.
  const page = (from: number, to: number) => {
    let query = supabase.from('recall_candidates').select('days_since_last_appointment').gte('days_since_last_appointment', RECALL_AFTER_DAYS)
    if (props.practitionerId) query = query.eq('default_practitioner_id', props.practitionerId)
    return query.order('patient_id').range(from, to)
  }
  const rows = await fetchAllRows<RecallRow>(page)
  if (isStale()) return
  count.value = rows.length
  const known = rows.map((r) => r.days_since_last_appointment).filter((d): d is number => d !== null)
  avgDays.value = known.length > 0 ? Math.round(known.reduce((sum, d) => sum + d, 0) / known.length) : null
  loading.value = false
}
onMounted(load)
watch(() => props.practitionerId, load)
</script>

<template>
  <div v-if="loading" class="space-y-1.5">
    <UiSkeleton class="h-[27px] w-10 rounded-ctlSm" />
    <UiSkeleton class="h-3 w-44 rounded-ctlSm" />
  </div>
  <div v-else>
    <p class="font-mono text-[27px] leading-none text-ink-900">{{ count }}</p>
    <p class="mt-1.5 text-[12px] text-ink-muted2">
      {{ avgDays !== null ? t(`3+ weeks since their last visit · avg ${avgDays} days`, `3+ semanas desde su última visita · media ${avgDays} días`) : t('No patients overdue for recall', 'Ningún paciente pendiente de recuerdo') }}
    </p>
    <NuxtLink to="/recalls" class="mt-1.5 inline-block text-[12px] font-medium text-brand-text hover:text-brand-hover">{{ t('View recalls →', 'Ver recuerdos →') }}</NuxtLink>
  </div>
</template>
