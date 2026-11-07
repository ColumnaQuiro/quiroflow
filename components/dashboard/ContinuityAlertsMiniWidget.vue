<script setup lang="ts">
// KPI: how many patients on an active care plan have fallen behind their
// own plan's cadence -- backed by care_plan_continuity_alerts, same shape
// as RecallsDueMiniWidget.vue but plan-aware instead of a flat threshold.
const props = defineProps<{ practitionerId?: string }>()

interface AlertRow { days_overdue: number | null }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const count = ref(0)
const avgDays = ref<number | null>(null)
const latest = useLatestRun()

async function load() {
  const isStale = latest.start()
  loading.value = true
  let query = supabase.from('care_plan_continuity_alerts').select('days_overdue')
  if (props.practitionerId) query = query.eq('default_practitioner_id', props.practitionerId)
  const rows = await fetchAllRows<AlertRow>((f, t) => query.range(f, t))
  if (isStale()) return
  count.value = rows.length
  const known = rows.map((r) => r.days_overdue).filter((d): d is number => d !== null)
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
      <!-- On the count, not on the average: a plan behind schedule with no
           days_overdue left avgDays null, and the tile then said "no care
           plans behind schedule" under a number that was not zero. -->
      {{
        count === 0
          ? t('No care plans behind schedule', 'Ningún plan de cuidados retrasado')
          : avgDays !== null
            ? t(`On average ${avgDays} days behind their plan`, `De media, ${avgDays} días de retraso sobre su plan`)
            : t('Behind their plan', 'Con retraso sobre su plan')
      }}
    </p>
    <NuxtLink to="/care-plan-alerts" class="mt-1.5 inline-block text-[12px] font-medium text-brand-text hover:text-brand-hover">{{ t('View alerts →', 'Ver alertas →') }}</NuxtLink>
  </div>
</template>
