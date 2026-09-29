<script setup lang="ts">
const ACTIVE_WINDOW_DAYS = 90

const props = defineProps<{ practitionerId?: string }>()

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const total = ref(0)
const active = ref(0)
const latest = useLatestRun()

async function load() {
  const isStale = latest.start()
  loading.value = true

  // The same count "Total patients" shows; asked once when both are on the
  // dashboard. See useSharedFetch.
  const totalQuery = sharedFetch(`patients-count:${props.practitionerId ?? ''}`, () => {
    let query = supabase.from('patients').select('id', { count: 'exact', head: true })
    if (props.practitionerId) query = query.eq('default_practitioner_id', props.practitionerId)
    return query
  })

  // The window starts in the browser's own day, as it always has; the
  // database counts the distinct patients rather than sending every
  // completed appointment across to be counted here.
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - ACTIVE_WINDOW_DAYS)

  const [{ count }, { data: activeCount, error }] = await Promise.all([
    totalQuery,
    supabase.rpc('dashboard_active_patient_count', { p_since: cutoff.toISOString(), p_practitioner_id: props.practitionerId || null }),
  ])
  if (isStale()) return
  if (error) throw error

  total.value = count ?? 0
  active.value = activeCount ?? 0
  loading.value = false
}
onMounted(load)
watch(() => props.practitionerId, load)

const pct = computed(() => (total.value === 0 ? 0 : Math.round((active.value / total.value) * 100)))
</script>

<template>
  <div v-if="loading" class="space-y-1.5">
    <UiSkeleton class="h-[27px] w-20 rounded-ctlSm" />
    <UiSkeleton class="h-3 w-32 rounded-ctlSm" />
  </div>
  <div v-else>
    <p class="font-mono text-[27px] leading-none text-ink-900">
      {{ active }} <span class="font-sans text-[14px] font-medium text-ink-muted2">({{ pct }}%)</span>
    </p>
    <p class="mt-1.5 text-[12px] text-ink-muted2">{{ t(`Seen in the last ${ACTIVE_WINDOW_DAYS} days`, `Atendidos en los últimos ${ACTIVE_WINDOW_DAYS} días`) }}</p>
  </div>
</template>
