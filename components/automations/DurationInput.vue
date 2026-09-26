<script setup lang="ts">
import { DELAY_UNITS, say, splitMinutes } from '~/utils/automationCatalog'
import { FIELD, FIELD_NUMBER } from '~/utils/automationUi'

// An amount and a unit, stored as minutes -- the one unit the engine's clock
// thinks in, so "2 hours" and "120 minutes" are never two different things.

const props = defineProps<{ modelValue: number; label: string; suffix?: string; testId?: string }>()
const emit = defineEmits<{ 'update:modelValue': [minutes: number] }>()
const t = useT()

const unit = ref(splitMinutes(props.modelValue).unit)
const amount = computed(() => {
  const per = DELAY_UNITS.find((u) => u.value === unit.value)!.minutes
  return Math.max(0, Math.round((Number(props.modelValue) || 0) / per))
})
watch(
  () => props.modelValue,
  (m) => {
    // An outside change (undo) re-picks the unit that divides it cleanly.
    const per = DELAY_UNITS.find((u) => u.value === unit.value)!.minutes
    if (m % per !== 0) unit.value = splitMinutes(m).unit
  },
)
function update(value: number, nextUnit = unit.value) {
  unit.value = nextUnit
  const per = DELAY_UNITS.find((u) => u.value === nextUnit)!.minutes
  emit('update:modelValue', Math.max(1, Math.round(value || 1)) * per)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2" :data-test="testId">
    <input type="number" min="1" :class="FIELD_NUMBER" :value="amount" :aria-label="label" @input="update(Number(($event.target as HTMLInputElement).value))" />
    <select :class="[FIELD, 'w-32']" :value="unit" :aria-label="t('Unit', 'Unidad')" @change="update(amount, ($event.target as HTMLSelectElement).value as 'minutes' | 'hours' | 'days')">
      <option v-for="u in DELAY_UNITS" :key="u.value" :value="u.value">{{ say(t, u.label) }}{{ suffix ? ` ${suffix}` : '' }}</option>
    </select>
  </div>
</template>
