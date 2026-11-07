<script setup lang="ts">
import type { DateRange } from '../../composables/useDateRangePresets'

const props = defineProps<{ dateRange: DateRange; practitionerId?: string; clinicId?: string }>()

interface AppointmentRow { starts_at: string; status: string }

const t = useT()
const supabase = useSupabaseClient()
const loading = ref(true)
const rows = ref<AppointmentRow[]>([])
const latest = useLatestRun()

async function load() {
  const isStale = latest.start()
  loading.value = true
  const { from, to } = rangeBounds(props.dateRange)
  const fetched = await fetchAllRows<AppointmentRow>((f, t) => {
    let query = supabase.from('appointments').select('starts_at, status').is('deleted_at', null).gte('starts_at', from.toISOString()).lte('starts_at', to.toISOString())
    if (props.practitionerId) query = query.eq('practitioner_id', props.practitionerId)
    if (props.clinicId) query = query.eq('clinic_id', props.clinicId)
    return query.range(f, t)
  })
  if (isStale()) return
  rows.value = fetched
  loading.value = false
}
onMounted(load)
watch(() => [props.dateRange, props.practitionerId, props.clinicId], load, { deep: true })

// The hours, not just a word: "Noche" for a 16:00 visit read as wrong to a
// Spanish clinic, where the afternoon runs into the evening. Same cut-offs
// as Reports > Appointment distribution.
const SHIFTS = computed(() => [
  { key: 'morning', label: t('Before 12pm', 'Antes de las 12h'), test: (h: number) => h < 12 },
  { key: 'afternoon', label: t('12–4pm', '12–16h'), test: (h: number) => h >= 12 && h < 16 },
  { key: 'evening', label: t('From 4pm', 'Desde las 16h'), test: (h: number) => h >= 16 },
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
  <div v-else>
    <ul class="divide-y divide-line-row2 text-[13px]">
      <li v-for="s in shiftStats" :key="s.key" class="flex items-center justify-between py-1.5">
        <span class="text-ink-700">{{ s.label }}</span>
        <span class="text-ink-muted2">{{ s.total === 1 ? t('1 visit', '1 visita') : t(`${s.total} visits`, `${s.total} visitas`) }}</span>
        <span class="font-mono text-[12.5px] text-ink-900">{{ s.showRate === null ? '—' : `${s.showRate}%` }}</span>
      </li>
    </ul>
    <p class="mt-1.5 border-t border-line-row2 pt-1.5 text-[11.5px] text-ink-muted2">
      {{ t('% is the show-up rate: visits attended out of attended plus no-shows.', '% es la tasa de asistencia: visitas atendidas sobre atendidas más ausencias.') }}
    </p>
  </div>
</template>
