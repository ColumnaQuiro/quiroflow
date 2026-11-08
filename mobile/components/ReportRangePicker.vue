<script setup lang="ts">
// The report period, as the web's components/reports/DateRangeSelect.vue
// offers it -- the same presets (STANDARD_PRESETS unless a report passes its
// own) and a custom range -- but as a chip that opens a sheet, since a
// dropdown 320px wide does not fit beside anything on a phone.
import { computePresetRange, STANDARD_PRESETS, type DateRange, type DateRangePreset } from '../../composables/useDateRangePresets'

const props = withDefaults(defineProps<{ presets?: DateRangePreset[] }>(), { presets: () => STANDARD_PRESETS })
const range = defineModel<DateRange>({ required: true })
const t = useT()
const open = ref(false)
const customFrom = ref(range.value.from)
const customTo = ref(range.value.to)
watch(open, (o) => {
  if (o) {
    customFrom.value = range.value.from
    customTo.value = range.value.to
  }
})

const presetLabel = (p: DateRangePreset) => (p.labelEs ? t(p.label ?? '', p.labelEs) : (p.label ?? ''))
const matched = computed(() =>
  props.presets.find((p) => {
    const r = computePresetRange(p)
    return r.from === range.value.from && r.to === range.value.to
  }),
)
const locale = computed(() => t('en-GB', 'es-ES'))
function short(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
}
const label = computed(() => (matched.value ? presetLabel(matched.value) : `${short(range.value.from)} – ${short(range.value.to)}`))

function pick(p: DateRangePreset) {
  range.value = computePresetRange(p)
  open.value = false
}
const customValid = computed(() => !!customFrom.value && !!customTo.value && customFrom.value <= customTo.value)
function applyCustom() {
  if (!customValid.value) return
  range.value = { from: customFrom.value, to: customTo.value }
  open.value = false
}
</script>

<template>
  <button
    type="button"
    class="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-control bg-surface pl-3 pr-2.5 text-[13px] font-semibold text-ink-700"
    :aria-label="t(`Period: ${label}`, `Periodo: ${label}`)"
    data-cy="report-range"
    @click="open = true"
  >
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true" class="text-ink-muted"><path d="M2.5 3.5h11v10h-11zM2.5 6.6h11M5.6 2v2M10.4 2v2" /></svg>
    <span class="whitespace-nowrap">{{ label }}</span>
    <AppChevron dir="down" :size="14" class="text-ink-muted" />
  </button>

  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex flex-col justify-end bg-black/30 md:items-center md:justify-center" data-cy="report-range-sheet" @click.self="open = false">
      <div v-sheet-drag="() => (open = false)" role="dialog" aria-modal="true" :aria-label="t('Period', 'Periodo')" class="flex max-h-[88%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[420px] md:rounded-[18px] md:pt-5" style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)">
        <div class="mx-auto h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
        <p class="text-[17px] font-semibold text-ink-900">{{ t('Period', 'Periodo') }}</p>
        <div class="flex flex-col">
          <button
            v-for="p in presets"
            :key="presetLabel(p)"
            type="button"
            class="flex h-12 items-center justify-between border-b border-line text-left text-[15px] last:border-b-0"
            :class="matched === p ? 'font-semibold text-brand-text' : 'text-ink-900'"
            data-cy="report-range-preset"
            @click="pick(p)"
          >
            {{ presetLabel(p) }}
            <svg v-if="matched === p" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.4" /></svg>
          </button>
        </div>
        <fieldset class="flex flex-col gap-2 border-t border-line pt-3">
          <legend class="mb-1 text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Custom range', 'Rango personalizado') }}</legend>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1 text-[12.5px] text-ink-muted">
              {{ t('From', 'Desde') }}
              <input v-model="customFrom" type="date" :max="customTo" class="h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[15px] text-ink-900" data-cy="report-range-from" />
            </label>
            <label class="flex flex-col gap-1 text-[12.5px] text-ink-muted">
              {{ t('To', 'Hasta') }}
              <input v-model="customTo" type="date" :min="customFrom" class="h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[15px] text-ink-900" data-cy="report-range-to" />
            </label>
          </div>
          <AppButton variant="primary" :disabled="!customValid" data-cy="report-range-apply" @click="applyCustom">{{ t('Apply', 'Aplicar') }}</AppButton>
        </fieldset>
      </div>
    </div>
  </Teleport>
</template>
