<script setup lang="ts">
// One month to jump the calendar to a day: today filled indigo, the day on
// screen ringed. Opens on the month of the day on screen each time, since it
// lives in a popover (and the phone drawer) that mounts it on demand.

const props = defineProps<{ selected: Date }>()
const emit = defineEmits<{ pick: [day: Date] }>()
const t = useT()

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const base = ref(new Date(props.selected.getFullYear(), props.selected.getMonth(), 1))
const label = computed(() => base.value.toLocaleDateString(t('en-GB', 'es-ES'), { month: 'long', year: 'numeric' }))
const weekdays = computed(() => [t('Mo', 'Lu'), t('Tu', 'Ma'), t('We', 'Mi'), t('Th', 'Ju'), t('Fr', 'Vi'), t('Sa', 'Sá'), t('Su', 'Do')])
const cells = computed(() => {
  const y = base.value.getFullYear()
  const m = base.value.getMonth()
  const out: (Date | null)[] = Array((base.value.getDay() + 6) % 7).fill(null)
  for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) out.push(new Date(y, m, d))
  return out
})
function shift(n: number) {
  base.value = new Date(base.value.getFullYear(), base.value.getMonth() + n, 1)
}
const today = new Date()
</script>

<template>
  <div data-cy="mini-month">
    <div class="flex items-center justify-between">
      <button type="button" :aria-label="t('Previous month', 'Mes anterior')" class="flex h-7 w-7 items-center justify-center rounded-ctlSm text-ink-faint hover:bg-surface-subtle hover:text-ink-600 touch:h-10 touch:w-10" @click="shift(-1)"><UiChevron dir="left" /></button>
      <span class="text-[12.5px] font-[640] text-ink-900 first-letter:uppercase">{{ label }}</span>
      <button type="button" :aria-label="t('Next month', 'Mes siguiente')" class="flex h-7 w-7 items-center justify-center rounded-ctlSm text-ink-faint hover:bg-surface-subtle hover:text-ink-600 touch:h-10 touch:w-10" @click="shift(1)"><UiChevron dir="right" /></button>
    </div>
    <div class="mt-2 grid grid-cols-7 gap-y-1 text-center">
      <span v-for="d in weekdays" :key="d" class="text-[11px] font-medium uppercase text-ink-faint">{{ d }}</span>
      <template v-for="(cell, i) in cells" :key="i">
        <button
          v-if="cell"
          type="button"
          class="mx-auto flex h-7 w-7 items-center justify-center rounded-full font-mono text-[11.5px] touch:h-10 touch:w-10"
          :class="sameDay(cell, today) ? 'bg-brand font-semibold text-brand-on' : sameDay(cell, selected) ? 'font-semibold text-brand-text ring-1 ring-inset ring-brand' : 'text-ink-600 hover:bg-surface-subtle'"
          :aria-current="sameDay(cell, selected) ? 'date' : undefined"
          @click="emit('pick', cell)"
        >
          {{ cell.getDate() }}
        </button>
        <span v-else />
      </template>
    </div>
  </div>
</template>
