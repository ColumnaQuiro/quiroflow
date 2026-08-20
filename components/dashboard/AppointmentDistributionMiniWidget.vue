<script setup lang="ts">
import type { DateRange } from '~/composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface AppointmentRow { starts_at: string; status: string }

const supabase = useSupabaseClient()
const loading = ref(true)
const rows = ref<AppointmentRow[]>([])

async function load() {
  loading.value = true
  const { from, to } = rangeBounds(props.dateRange)
  rows.value = await fetchAllRows<AppointmentRow>((f, t) => {
    let query = supabase.from('appointments').select('starts_at, status').gte('starts_at', from.toISOString()).lte('starts_at', to.toISOString())
    if (props.practitionerId) query = query.eq('practitioner_id', props.practitionerId)
    if (props.clinicId) query = query.eq('clinic_id', props.clinicId)
    return query.range(f, t)
  })
  loading.value = false
}
onMounted(load)
watch(() => [props.dateRange, props.practitionerId, props.clinicId], load, { deep: true })

const SHIFTS = [
  { key: 'morning', label: 'Morning', test: (h: number) => h < 12 },
  { key: 'afternoon', label: 'Afternoon', test: (h: number) => h >= 12 && h < 16 },
  { key: 'evening', label: 'Evening', test: (h: number) => h >= 16 },
]

const shiftStats = computed(() =>
  SHIFTS.map((shift) => {
    const inShift = rows.value.filter((r) => shift.test(new Date(r.starts_at).getHours()))
    const completed = inShift.filter((r) => r.status === 'completed').length
    const noShow = inShift.filter((r) => r.status === 'no_show').length
    const finished = completed + noShow
    return { ...shift, total: inShift.length, showRate: finished === 0 ? null : Math.round((completed / finished) * 100) }
  }),
)
</script>

<template>
  <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
  <div v-else class="grid grid-cols-3 gap-2 text-center text-sm">
    <div v-for="s in shiftStats" :key="s.key">
      <p class="text-xs text-gray-500">{{ s.label }}</p>
      <p class="text-lg font-semibold text-gray-900">{{ s.total }}</p>
      <p class="text-xs text-gray-400">{{ s.showRate === null ? '—' : `${s.showRate}%` }}</p>
    </div>
  </div>
</template>
