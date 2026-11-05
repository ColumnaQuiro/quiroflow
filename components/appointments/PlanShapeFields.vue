<script setup lang="ts">
import { carePlanCadenceLabel } from '../../utils/carePlanCadence'
import type { PlanShape } from '../../utils/planRenewal'

// "N visits every M weeks/months, for ever or for N visits": a plan's cadence
// and length, edited in one place. Settings > Care plans uses it for the
// clinic's maintenance and the review card (AppointmentsPlanRenewal) for the
// plan it proposes, so the two read the same. Shared with mobile/, so
// relative imports.
const model = defineModel<PlanShape>({ required: true })
defineProps<{ disabled?: boolean; cyPrefix: string }>()
const t = useT()
const group = useId()

function set<K extends keyof PlanShape>(key: K, value: PlanShape[K]) {
  model.value = { ...model.value, [key]: value }
}
const clampInt = (v: unknown, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || min)))
// Kept while "Sin fin" is chosen, so switching back offers the number it had.
const lastLength = ref(model.value.total_visits ?? 12)
watch(
  () => model.value.total_visits,
  (v) => {
    if (v !== null) lastLength.value = v
  },
)
const field = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-2.5 text-[13.5px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-60'
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div class="flex flex-wrap items-center gap-2 text-[13.5px] text-ink-900">
      <input
        :value="model.visits_per_period"
        type="number"
        min="1"
        max="7"
        :disabled="disabled"
        :aria-label="t('Visits', 'Visitas')"
        :class="[field, 'w-16 text-center font-mono']"
        :data-cy="`${cyPrefix}-per-period`"
        @change="set('visits_per_period', clampInt(($event.target as HTMLInputElement).value, 1, 7))"
      />
      <span>{{ model.visits_per_period === 1 ? t('visit every', 'visita cada') : t('visits every', 'visitas cada') }}</span>
      <input
        :value="model.frequency_value"
        type="number"
        min="1"
        max="52"
        :disabled="disabled"
        :aria-label="t('Every how many', 'Cada cuántas')"
        :class="[field, 'w-16 text-center font-mono']"
        :data-cy="`${cyPrefix}-every`"
        @change="set('frequency_value', clampInt(($event.target as HTMLInputElement).value, 1, 52))"
      />
      <select :value="model.frequency_unit" :disabled="disabled" :aria-label="t('Period', 'Periodo')" :class="field" :data-cy="`${cyPrefix}-unit`" @change="set('frequency_unit', ($event.target as HTMLSelectElement).value)">
        <option value="week">{{ model.frequency_value > 1 ? t('weeks', 'semanas') : t('week', 'semana') }}</option>
        <option value="month">{{ model.frequency_value > 1 ? t('months', 'meses') : t('month', 'mes') }}</option>
      </select>
      <span class="text-[12.5px] text-ink-muted" :data-cy="`${cyPrefix}-cadence`">· {{ carePlanCadenceLabel(model, t) }}</span>
    </div>
    <div class="flex flex-col gap-2" role="radiogroup" :aria-label="t('How long', 'Duración')">
      <label class="flex items-center gap-2.5 text-[13.5px] text-ink-900">
        <input type="radio" :name="group" :checked="model.total_visits === null" :disabled="disabled" class="h-4 w-4 accent-brand" :data-cy="`${cyPrefix}-no-end`" @change="set('total_visits', null)" />
        <span><strong>{{ t('No end', 'Sin fin') }}</strong> <span class="text-[12.5px] text-ink-muted">· {{ t('until someone closes it', 'sigue hasta que alguien lo cierre') }}</span></span>
      </label>
      <label class="flex flex-wrap items-center gap-2.5 text-[13.5px] text-ink-900">
        <input type="radio" :name="group" :checked="model.total_visits !== null" :disabled="disabled" class="h-4 w-4 accent-brand" :data-cy="`${cyPrefix}-fixed`" @change="set('total_visits', lastLength)" />
        <span>{{ t('A number of visits', 'Un número de visitas') }}</span>
        <input
          :value="model.total_visits ?? lastLength"
          type="number"
          min="1"
          max="200"
          :disabled="disabled || model.total_visits === null"
          :aria-label="t('Visits in the plan', 'Visitas del plan')"
          :class="[field, 'w-20 text-center font-mono']"
          :data-cy="`${cyPrefix}-total`"
          @change="set('total_visits', clampInt(($event.target as HTMLInputElement).value, 1, 200))"
        />
      </label>
    </div>
  </div>
</template>
