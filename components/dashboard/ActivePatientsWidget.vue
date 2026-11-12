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

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - ACTIVE_WINDOW_DAYS)

  // Counted in the database (dashboard_active_patients): this used to read
  // every completed visit of the window to count the patients in them, a
  // page of rows per thousand visits for one number.
  const activeQuery = supabase.rpc('dashboard_active_patients' as never, { p_since: cutoff.toISOString(), p_practitioner_id: props.practitionerId || null } as never)

  const [{ count, error }, counted] = await Promise.all([totalQuery, activeQuery])
  if (isStale()) return
  if (error) throw error
  if (counted.error) throw counted.error

  total.value = count ?? 0
  active.value = (counted.data as unknown as number | null) ?? 0
  loading.value = false
}
onMounted(load)
watch(() => props.practitionerId, load)

const pct = computed(() => (total.value === 0 ? 0 : Math.round((active.value / total.value) * 100)))
</script>

<template>
  <div v-if="loading" class="space-y-1.5">
    <UiSkeleton class="h-[23px] w-20 rounded-ctlSm" />
    <UiSkeleton class="h-3 w-32 rounded-ctlSm" />
  </div>
  <div v-else>
    <p class="font-mono text-[23px] font-semibold leading-none text-ink-900">
      {{ active }} <span class="font-sans text-[14px] font-medium text-ink-muted2">({{ pct }}%)</span>
    </p>
    <!-- Says what the percentage is of; on its own "(34%)" left that to guess. -->
    <p class="mt-1.5 text-[12px] text-ink-muted2">{{ t(`Seen in the last ${ACTIVE_WINDOW_DAYS} days, out of ${total} patients`, `Atendidos en los últimos ${ACTIVE_WINDOW_DAYS} días, de ${total} pacientes en total`) }}</p>
  </div>
</template>
