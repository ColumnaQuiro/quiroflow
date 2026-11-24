<script setup lang="ts">
// The calendar colour of an appointment type or a team member: the presets
// from utils/calendarPalette, and a "Custom" swatch that opens the system
// colour picker for anything deeper or louder than them. A free colour can
// read as red or vanish into one theme's surface, so the picker says so
// underneath -- it warns, it does not refuse.
import { CALENDAR_PALETTE, CALENDAR_PALETTE_ROWS, calendarBlockColors, calendarColorWarnings, isPaletteColor, normalizeCalendarColor } from '~/utils/calendarPalette'

const props = defineProps<{
  modelValue: string
  /** Accessible name of the group. */
  label: string
  /** data-cy on each preset swatch (the custom one is always `color-custom`). */
  swatchCy?: string
  /** When set, a sample appointment block in the chosen colour. */
  preview?: { title: string; meta: string }
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const t = useT()

const current = computed(() => (props.modelValue ?? '').toLowerCase())
const isCustom = computed(() => !!current.value && !isPaletteColor(current.value))
// The last free colour, kept while a preset is tried, so going back to it
// does not mean finding it again in the system picker.
const lastCustom = ref(isCustom.value ? current.value : '')
watch(current, (v) => {
  if (v && !isPaletteColor(v)) lastCustom.value = v
})
const pickerValue = computed(() => normalizeCalendarColor(lastCustom.value) ?? normalizeCalendarColor(current.value) ?? CALENDAR_PALETTE[0]!.hex)

const input = ref<HTMLInputElement | null>(null)
function openPicker() {
  if (!isCustom.value && lastCustom.value) emit('update:modelValue', lastCustom.value)
  const el = input.value
  if (!el) return
  try {
    el.showPicker()
  } catch {
    el.click()
  }
}
function onPick(e: Event) {
  const v = normalizeCalendarColor((e.target as HTMLInputElement).value)
  if (v) emit('update:modelValue', v)
}

const warnings = computed(() =>
  calendarColorWarnings(current.value).map((w) =>
    w === 'red'
      ? t('Reads as red: on the calendar, red means money owed.', 'Parece rojo: en el calendario el rojo significa dinero pendiente.')
      : w === 'faint-light'
        ? t('Very light: it will barely show in light mode.', 'Muy claro: apenas se verá en el modo claro.')
        : t('Very dark: it will barely show in dark mode.', 'Muy oscuro: apenas se verá en el modo oscuro.'),
  ),
)

// The "any colour" wheel, drawn from the presets themselves: they are data,
// not styling, and the wheel only has to say "more than these".
const WHEEL = ['Orange', 'Yellow', 'Lime', 'Teal', 'Sky', 'Blue', 'Violet', 'Fuchsia', 'Pink']
const wheelStops = WHEEL.map((en) => CALENDAR_PALETTE.find((c) => c.en === en)!.hex)
const rainbow = `conic-gradient(${[...wheelStops, wheelStops[0]].join(', ')})`

// The sample block, painted exactly as AppointmentBlock paints a live visit.
const block = computed(() => calendarBlockColors(current.value))
const blockStyle = computed(() =>
  block.value
    ? { background: block.value.fill, border: `1px solid ${block.value.border}`, '--sample-on': block.value.text, '--sample-muted': block.value.textMuted, color: 'rgb(var(--sample-on))' }
    : { background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-line))' },
)
const blockMetaStyle = computed(() => (block.value ? { color: 'rgb(var(--sample-muted))' } : {}))
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div role="radiogroup" :aria-label="label" class="flex max-w-[432px] flex-wrap gap-1.5" data-cy="color-picker">
      <button
        v-for="c in CALENDAR_PALETTE_ROWS.flat()"
        :key="c.hex"
        type="button"
        role="radio"
        :aria-checked="current === c.hex"
        :aria-label="t(c.en, c.es)"
        :title="t(c.en, c.es)"
        :data-cy="swatchCy"
        :data-color="c.hex"
        class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center rounded-full border-2"
        :class="current === c.hex ? 'border-ink-900' : 'border-transparent hover:border-line-controlHover'"
        @click="emit('update:modelValue', c.hex)"
      >
        <span class="h-7 w-7 touch:h-9 touch:w-9 rounded-full" :style="{ background: c.hex }" />
      </button>

      <!-- Custom: a radio like the rest, with the system picker under it so
           it opens where the swatch is. -->
      <span class="relative">
        <button
          type="button"
          role="radio"
          :aria-checked="isCustom"
          :aria-label="t('Custom', 'Personalizado')"
          :title="t('Choose any colour', 'Elige cualquier color')"
          :data-color="isCustom ? current : undefined"
          data-cy="color-custom"
          class="flex h-9 touch:h-11 items-center gap-2 rounded-full border-2 pl-1 pr-3 text-[13px] font-semibold text-ink-700"
          :class="isCustom ? 'border-ink-900' : 'border-line-control hover:border-line-controlHover'"
          @click="openPicker"
        >
          <span class="flex h-7 w-7 touch:h-9 touch:w-9 items-center justify-center rounded-full" :style="{ background: rainbow }" aria-hidden="true">
            <span v-if="lastCustom" class="h-4 w-4 touch:h-5 touch:w-5 rounded-full border-2 border-surface" :style="{ background: lastCustom }" />
          </span>
          {{ t('Custom', 'Personalizado') }}
          <span v-if="isCustom" class="font-mono text-[12px] font-normal uppercase text-ink-muted">{{ current }}</span>
        </button>
        <input
          ref="input"
          type="color"
          :value="pickerValue"
          tabindex="-1"
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          data-cy="color-custom-input"
          @input="onPick"
        />
      </span>
    </div>

    <p v-for="w in warnings" :key="w" class="text-[12.5px] font-semibold text-warning-text" data-cy="color-warning">{{ w }}</p>

    <div v-if="preview" class="flex flex-col gap-1.5" aria-hidden="true">
      <span class="text-[12px] text-ink-muted">{{ t('How it looks on the calendar', 'Así se ve en el calendario') }}</span>
      <span class="flex max-w-[260px] flex-col gap-0.5 rounded-ctl px-[9px] py-1.5" :style="blockStyle" data-cy="color-preview">
        <strong class="text-[13px]">{{ preview.title }}</strong>
        <span class="text-[11.5px]" :style="blockMetaStyle">{{ preview.meta }}</span>
      </span>
    </div>
  </div>
</template>
