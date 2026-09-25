<script setup lang="ts">
import type { BusinessHours } from '~/utils/businessHours'
import { WEEK, copyMondayToWeekdays, type HoursProblem } from '~/utils/clinicHours'

// A week of opening hours, edited in place on clinics.business_hours' own
// shape. A closed day is an empty list, exactly as the calendar and the
// booking page already read it.
// emptyNote replaces the clinic's explanation of an empty week, for a
// practitioner's own hours, where an empty week means something else.
const props = defineProps<{ modelValue: BusinessHours; problems: Record<string, HoursProblem>; emptyNote?: string }>()
const emit = defineEmits<{ 'update:modelValue': [BusinessHours] }>()
const t = useT()
const { preference } = useLang()

// What a day had before it was switched off, so switching it back on returns
// it rather than a default.
const lastOpen: Record<string, [string, string][]> = {}

function set(day: string, ranges: [string, string][]) {
  emit('update:modelValue', { ...props.modelValue, [day]: ranges })
}
function toggle(day: string) {
  const ranges = props.modelValue[day] ?? []
  if (ranges.length > 0) {
    lastOpen[day] = ranges.map(([s, e]) => [s, e])
    set(day, [])
  } else {
    set(day, lastOpen[day] ?? [['09:00', '14:00']])
  }
}
function edit(day: string, i: number, end: 0 | 1, value: string) {
  const ranges = (props.modelValue[day] ?? []).map(([s, e]) => [s, e] as [string, string])
  ranges[i][end] = value
  set(day, ranges)
}
function addRange(day: string) {
  const ranges = props.modelValue[day] ?? []
  const last = ranges[ranges.length - 1]
  set(day, [...ranges, last ? [last[1], last[1] < '20:00' ? '20:00' : '23:59'] : ['16:00', '20:00']])
}
function removeRange(day: string, i: number) {
  set(day, (props.modelValue[day] ?? []).filter((_, j) => j !== i))
}
function copyMonday() {
  emit('update:modelValue', copyMondayToWeekdays(props.modelValue))
}

function problemText(p: HoursProblem) {
  if (p === 'incomplete') return t('Fill in both times.', 'Completa las dos horas.')
  if (p === 'backwards') return t('A range ends before it starts.', 'Un tramo termina antes de empezar.')
  return t('Two ranges overlap.', 'Dos tramos se solapan.')
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Every day empty is "not configured" (hasBusinessHoursConfigured),
    not "closed all week": the calendar then marks nothing as out of hours.
    Online booking still needs hours from somewhere, so say where. -->
    <p v-if="WEEK.every((d) => (modelValue[d.key] ?? []).length === 0)" class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700" data-cy="hours-not-set">
      {{ emptyNote ?? t('No opening hours yet. The calendar marks no time as closed, and online booking only offers practitioners who have hours of their own. Switch on the days you open.', 'Aún sin horario. El calendario no marca ninguna hora como cerrada, y la reserva online solo ofrece a los profesionales con horario propio. Activa los días que abrís.') }}
    </p>
    <div class="overflow-hidden rounded-card border border-line">
      <div
        v-for="(d, i) in WEEK"
        :key="d.key"
        data-cy="hours-day"
        :data-day="d.key"
        class="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-3.5 py-2"
        :class="[i > 0 ? 'border-t border-line-row' : '', (modelValue[d.key] ?? []).length === 0 ? 'bg-surface-subtle' : '']"
      >
        <span class="w-[92px] shrink-0 text-[14px] font-semibold text-ink-900">{{ preference === 'es' ? d.es : d.en }}</span>
        <button
          type="button"
          role="switch"
          data-cy="hours-day-toggle"
          :aria-checked="(modelValue[d.key] ?? []).length > 0"
          :aria-label="t(`Open on ${d.en}`, `Abierto el ${d.es.toLowerCase()}`)"
          class="relative my-[9px] h-[26px] w-11 shrink-0 rounded-full"
          :class="(modelValue[d.key] ?? []).length > 0 ? 'bg-brand' : 'bg-line-control'"
          @click="toggle(d.key)"
        >
          <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="(modelValue[d.key] ?? []).length > 0 ? 'left-[21px]' : 'left-[3px]'" />
        </button>
        <div v-if="(modelValue[d.key] ?? []).length > 0" class="flex flex-1 flex-wrap items-center gap-2">
          <span v-for="(r, j) in modelValue[d.key]" :key="j" class="inline-flex items-center gap-1 rounded-ctl border border-line-control bg-surface py-0.5 pl-1.5 pr-0.5" data-cy="hours-range">
            <input
              type="time"
              :value="r[0]"
              :aria-label="t(`${d.en} range ${j + 1} opens`, `${d.es}, tramo ${j + 1}, abre`)"
              class="h-9 rounded-ctlSm bg-transparent px-1 font-mono text-[13.5px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-brand"
              @input="edit(d.key, j, 0, ($event.target as HTMLInputElement).value)"
            />
            <span class="text-ink-muted">–</span>
            <input
              type="time"
              :value="r[1]"
              :aria-label="t(`${d.en} range ${j + 1} closes`, `${d.es}, tramo ${j + 1}, cierra`)"
              class="h-9 rounded-ctlSm bg-transparent px-1 font-mono text-[13.5px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-brand"
              @input="edit(d.key, j, 1, ($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-ctlSm text-[18px] text-ink-muted hover:bg-surface-subtle hover:text-ink-700"
              :aria-label="t(`Remove ${r[0]}–${r[1]}`, `Quitar ${r[0]}–${r[1]}`)"
              @click="removeRange(d.key, j)"
            >×</button>
          </span>
          <button
            type="button"
            data-cy="hours-add-range"
            class="h-10 rounded-ctl border border-dashed border-line-control px-2.5 text-[13px] font-semibold text-ink-500 hover:text-ink-700"
            @click="addRange(d.key)"
          >
            {{ t('+ Range', '+ Tramo') }}
          </button>
        </div>
        <span v-else class="flex-1 text-[13.5px] text-ink-muted">{{ t('Closed', 'Cerrado') }}</span>
        <p v-if="problems[d.key]" class="w-full text-[12.5px] font-semibold text-danger-text" data-cy="hours-problem">{{ problemText(problems[d.key]) }}</p>
      </div>
    </div>
    <div>
      <button
        type="button"
        data-cy="hours-copy-monday"
        class="h-11 rounded-ctl border border-line-control bg-surface px-3.5 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle"
        @click="copyMonday"
      >
        {{ t('Copy Monday to Tuesday–Friday', 'Copiar el lunes a martes–viernes') }}
      </button>
    </div>
  </div>
</template>
