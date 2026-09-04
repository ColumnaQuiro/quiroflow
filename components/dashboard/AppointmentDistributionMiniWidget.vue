<script setup lang="ts">
import type { DateRange } from '~/composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface AppointmentRow { starts_at: string; status: string }

const t = useT()
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

const SHIFTS = computed(() => [
  { key: 'morning', label: t('Morning', 'Mañana'), test: (h: number) => h < 12 },
  { key: 'afternoon', label: t('Afternoon', 'Tarde'), test: (h: number) => h >= 12 && h < 16 },
  { key: 'evening', label: t('Evening', 'Noche'), test: (h: number) => h >= 16 },
])

const shiftStats = computed(() =>
  SHIFTS.value.map((shift) => {
    const inShift = rows.value.filter((r) => shift.test(new Date(r.starts_at).getHours()))
    const completed = inShift.filter((r) => r.status === 'completed').length
    const noShow = inShift.filter((r) => r.status === 'no_show').length
    const finished = completed + noShow
    return { ...shift, total: inShift.length, showRate: finished === 0 ? null : Math.round((completed / finished) * 100) }
  }),
)
</script>

<template>
  <div v-if="loading" class="space-y-2">
    <div v-for="i in 3" :key="i" class="flex items-center justify-between py-1.5">
      <UiSkeleton class="h-3 w-20 rounded-ctlSm" />
      <UiSkeleton class="h-3 w-8 rounded-ctlSm" />
    </div>
  </div>
  <ul v-else class="divide-y divide-line-row2 text-[13px]">
    <li v-for="s in shiftStats" :key="s.key" class="flex items-center justify-between py-1.5">
      <span class="text-ink-700">{{ s.label }}</span>
      <span class="text-ink-muted2">{{ t(`${s.total} visits`, `${s.total} visitas`) }}</span>
      <span class="font-mono text-[12.5px] text-ink-900">{{ s.showRate === null ? '—' : `${s.showRate}%` }}</span>
    </li>
  </ul>
</template>
