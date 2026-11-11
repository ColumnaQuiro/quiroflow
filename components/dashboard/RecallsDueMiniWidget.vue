<script setup lang="ts">
// KPI: how many patients are currently due for a recall, backed by the same
// recall_candidates view the Recalls page and sidebar badge use -- and at the
// same 3 weeks the Recalls list opens with, so the number is the length of the
// list "View recalls" leads to. Without it the tile counted everyone lapsed at
// all, and read 1000 beside a sidebar saying 577.
const RECALL_AFTER_DAYS = 21
const props = defineProps<{ practitionerId?: string }>()

interface RecallsDue { count: number; days_total: number }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const count = ref(0)
const avgDays = ref<number | null>(null)
const latest = useLatestRun()

async function load() {
  const isStale = latest.start()
  loading.value = true
  // Counted through the view in the database (dashboard_recalls_due). The
  // tile used to page the whole list -- a request per thousand patients due --
  // to show how long it was and one average.
  const { data, error } = await supabase.rpc('dashboard_recalls_due' as never, { p_min_days: RECALL_AFTER_DAYS, p_practitioner_id: props.practitionerId || null } as never)
  if (isStale()) return
  if (error) throw error
  const due = (data ?? { count: 0, days_total: 0 }) as unknown as RecallsDue
  count.value = due.count
  // Every row counted has a day count (the filter is on it), so the total
  // over the count is the average the rows gave.
  avgDays.value = due.count > 0 ? Math.round(due.days_total / due.count) : null
  loading.value = false
}
onMounted(load)
watch(() => props.practitionerId, load)
</script>

<template>
  <div v-if="loading" class="space-y-1.5">
    <UiSkeleton class="h-[23px] w-10 rounded-ctlSm" />
    <UiSkeleton class="h-3 w-44 rounded-ctlSm" />
  </div>
  <div v-else>
    <p class="font-mono text-[23px] font-semibold leading-none text-ink-900">{{ count }}</p>
    <p class="mt-1.5 text-[12px] text-ink-muted2">
      {{ avgDays !== null ? t(`3+ weeks since their last visit · ${avgDays} days on average`, `3+ semanas desde su última visita · ${avgDays} días de media`) : t('No patients due for a recall', 'Ningún paciente pendiente de recordatorio') }}
    </p>
    <!-- "Recordatorios", the name the sidebar and the page itself use; this
         link alone said "recuerdos". -->
    <NuxtLink to="/recalls" class="mt-1.5 inline-flex items-center gap-0.5 text-[12px] font-medium text-brand-text hover:text-brand-hover">{{ t('View recalls', 'Ver recordatorios') }}<UiChevron dir="right" /></NuxtLink>
  </div>
</template>
