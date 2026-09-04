<script setup lang="ts">
const ACTIVE_WINDOW_DAYS = 90

const props = defineProps<{ practitionerId?: string }>()

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const total = ref(0)
const active = ref(0)

async function load() {
  loading.value = true

  let totalQuery = supabase.from('patients').select('id', { count: 'exact', head: true })
  if (props.practitionerId) totalQuery = totalQuery.eq('default_practitioner_id', props.practitionerId)

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - ACTIVE_WINDOW_DAYS)

  let activeQuery = supabase
    .from('appointments')
    .select('patient_id')
    .eq('status', 'completed')
    .gte('starts_at', cutoff.toISOString())
  if (props.practitionerId) activeQuery = activeQuery.eq('practitioner_id', props.practitionerId)

  const [{ count }, rows] = await Promise.all([totalQuery, fetchAllRows((f, t) => activeQuery.range(f, t))])

  total.value = count ?? 0
  active.value = new Set(rows.map((r) => r.patient_id)).size
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
