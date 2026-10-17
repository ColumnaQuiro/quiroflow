<script setup lang="ts">
import { clinicDateOf } from '~/utils/clinicClock'
import { HOLIDAY_REGIONS, HOLIDAY_YEARS, HOLIDAYS_KNOWN_THROUGH, holidaysFor } from '~/utils/spanishHolidays'

// The official holidays of the clinic's comunidad, closed by themselves
// (server/api/clinics/[id]/holidays.post.ts). They land in the closures list
// below as ordinary whole-day closures, so removing one there is how a clinic
// opens on a holiday; it does not come back.
const props = defineProps<{ clinicId: string; timezone: string }>()
const emit = defineEmits<{ changed: [] }>()
const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const t = useT()
const { showToast } = useToast()

const region = ref('')
const auto = ref(false)
const loaded = ref(false)
onMounted(async () => {
  const { data } = await supabase.from('clinics').select('holiday_region, holidays_auto').eq('id', props.clinicId).maybeSingle()
  region.value = data?.holiday_region ?? ''
  auto.value = !!data?.holidays_auto
  loaded.value = true
})

const today = computed(() => clinicDateOf(new Date(), props.timezone))
const upcoming = computed(() => (region.value ? holidaysFor(region.value, today.value, HOLIDAYS_KNOWN_THROUGH) : []))
const nextYear = HOLIDAY_YEARS[HOLIDAY_YEARS.length - 1]! + 1
function fmt(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('es-ES', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

const saving = ref(false)
const closed = ref<{ date: string; name: string; booked: number }[] | null>(null)
async function save(nextAuto: boolean, nextRegion = region.value) {
  saving.value = true
  closed.value = null
  try {
    const r = await authedFetch<{ closed: { date: string; name: string; booked: number }[] }>(`/api/clinics/${props.clinicId}/holidays`, {
      method: 'POST',
      body: { region: nextRegion || null, auto: nextAuto },
    })
    auto.value = nextAuto
    region.value = nextRegion
    if (nextAuto) closed.value = r.closed
    emit('changed')
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t("Couldn't update the holidays.", 'No se han podido actualizar los festivos.'), 'error')
  } finally {
    saving.value = false
  }
}
// A new comunidad while it is on swaps the holidays at once; while off it is
// only remembered for when it is turned on.
async function pickRegion(next: string) {
  if (auto.value && next) await save(true, next)
  else if (auto.value && !next) await save(false, '')
  else region.value = next
}
const withVisits = computed(() => (closed.value ?? []).filter((h) => h.booked > 0))
</script>

<template>
  <div v-if="loaded" class="flex flex-col gap-3 rounded-card border border-line bg-surface-subtle p-4" data-cy="clinic-holidays">
    <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
      {{ t('Comunidad autónoma', 'Comunidad autónoma') }}
      <select
        :value="region"
        :disabled="saving"
        data-cy="holiday-region"
        class="h-9 touch:h-11 max-w-[320px] rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none"
        @change="pickRegion(($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('Choose…', 'Elige…') }}</option>
        <option v-for="(name, code) in HOLIDAY_REGIONS" :key="code" :value="code">{{ name }}</option>
      </select>
    </label>
    <SettingsSwitchRow
      :model-value="auto"
      :disabled="saving || !region"
      :divided="false"
      data-cy="holidays-auto"
      :title="t('Close on the official holidays', 'Cerrar en los festivos oficiales')"
      :description="t('National and regional, as published in the BOE, this year and the years to come. Each one is added below as a closure: remove it there to open that day.', 'Nacionales y de tu comunidad, tal como los publica el BOE, este año y los siguientes. Cada uno se añade abajo como un cierre: quítalo ahí para abrir ese día.')"
      @update:model-value="save($event)"
    />

    <div v-if="closed" class="rounded-ctl border border-success-border bg-success-bg px-3 py-2 text-[13px] text-success-text" data-cy="holidays-closed">
      {{ closed.length ? t(`${closed.length} holidays closed.`, `${closed.length} festivos cerrados.`) : t('They were already closed.', 'Ya estaban cerrados.') }}
    </div>
    <div v-if="withVisits.length" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-warning-text" data-cy="holidays-booked">
      <p class="font-semibold">{{ t('There are visits booked on some of them. Closing hides the free slots but moves nobody:', 'Hay visitas reservadas en algunos. Cerrar oculta los huecos libres, pero no mueve a nadie:') }}</p>
      <ul class="mt-1 list-disc pl-5">
        <li v-for="h in withVisits" :key="h.date" data-cy="holidays-booked-day">{{ fmt(h.date) }} · {{ h.name }}: {{ t(`${h.booked} visits`, `${h.booked} citas`) }}</li>
      </ul>
    </div>

    <details v-if="region" class="text-[13px] text-ink-700" data-cy="holidays-preview">
      <summary class="cursor-pointer font-semibold">{{ t(`The ${upcoming.length} still to come in ${HOLIDAY_REGIONS[region]}`, `Los ${upcoming.length} que quedan en ${HOLIDAY_REGIONS[region]}`) }}</summary>
      <ul class="mt-2 flex flex-col gap-1">
        <li v-for="h in upcoming" :key="h.date" class="flex gap-3" data-cy="holidays-preview-day">
          <span class="w-[150px] shrink-0 font-mono text-[12.5px] text-ink-500">{{ fmt(h.date) }}</span><span>{{ h.name }}</span>
        </li>
      </ul>
    </details>
    <p class="text-[12.5px] text-ink-muted">
      {{ t(`The two local holidays of your town are not in the BOE: add them below.`, `Los dos festivos locales de tu municipio no salen en el BOE: añádelos abajo.`) }}
      <template v-if="region === 'ES-CN'">{{ t("Nor is your island's own holiday.", 'Tampoco el festivo de tu isla.') }}</template>
      {{ t(`${nextYear}'s are published in October and added by themselves.`, `Los de ${nextYear} se publican en octubre y se añaden solos.`) }}
    </p>
  </div>
</template>
