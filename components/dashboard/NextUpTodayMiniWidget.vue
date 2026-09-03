<script setup lang="ts">
// List: the next few booked (not yet completed/cancelled) appointments left
// today, soonest first.
const props = defineProps<{ practitionerId?: string; clinicId?: string }>()
const t = useT()

interface ApptRow {
  id: string
  starts_at: string
  practitioner_name: string | null
  patients: { first_name: string; last_name: string | null } | null
}

const supabase = useSupabaseClient()
const loading = ref(true)
const rows = ref<ApptRow[]>([])

async function load() {
  loading.value = true
  const now = new Date()
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)
  let query = supabase
    .from('appointments')
    .select('id, starts_at, practitioner_name, patients(first_name, last_name)')
    .eq('status', 'booked')
    .is('deleted_at', null)
    .gte('starts_at', now.toISOString())
    .lte('starts_at', endOfDay.toISOString())
    .order('starts_at', { ascending: true })
    .limit(6)
  if (props.practitionerId) query = query.eq('practitioner_id', props.practitionerId)
  if (props.clinicId) query = query.eq('clinic_id', props.clinicId)
  const { data } = await query
  rows.value = (data as unknown as ApptRow[]) ?? []
  loading.value = false
}
onMounted(load)
watch(() => [props.practitionerId, props.clinicId], load)

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
function patientName(r: ApptRow) {
  return r.patients ? `${r.patients.first_name} ${r.patients.last_name ?? ''}`.trim() : t('Unknown patient', 'Paciente desconocido')
}
</script>

<template>
  <div v-if="loading" class="text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
  <p v-else-if="rows.length === 0" class="text-[13px] text-ink-faint">{{ t('Nothing left booked today.', 'No quedan citas reservadas hoy.') }}</p>
  <ul v-else class="divide-y divide-line-row2">
    <li v-for="r in rows" :key="r.id" class="flex items-center gap-2 py-1.5 text-[13px] first:pt-0 last:pb-0">
      <span class="min-w-0 flex-1 truncate text-ink-700">{{ patientName(r) }}</span>
      <span class="shrink-0 truncate text-ink-muted2">{{ r.practitioner_name ?? '' }}</span>
      <span class="shrink-0 font-mono text-[12.5px] text-ink-600">{{ timeLabel(r.starts_at) }}</span>
    </li>
  </ul>
</template>
