<script setup lang="ts">
import { FIELD, HINT, LABEL, SEGMENT_WRAP, segmentBtn } from '~/utils/automationUi'

// Give or take away a patient type. Giving one brings the exercises it has
// (Exercises › By type) and starts the automations that begin on it, as when
// someone on the team does it; taking one away ends what it brought.
const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div :class="SEGMENT_WRAP" role="group">
      <button type="button" :class="segmentBtn(config.mode !== 'remove')" :aria-pressed="config.mode !== 'remove'" @click="set({ mode: 'add' })">{{ t('Give', 'Poner') }}</button>
      <button type="button" :class="segmentBtn(config.mode === 'remove')" :aria-pressed="config.mode === 'remove'" data-test="patient-type-remove" @click="set({ mode: 'remove' })">{{ t('Take away', 'Quitar') }}</button>
    </div>
    <label :class="LABEL">
      {{ t('Patient type', 'Tipo de paciente') }}
      <select :class="FIELD" :value="config.type_id ?? ''" data-test="patient-type-select" @change="set({ type_id: ($event.target as HTMLSelectElement).value || null })">
        <option value="">{{ t('Choose a type…', 'Elige un tipo…') }}</option>
        <option v-for="ty in b.lookup.value.patientTypes ?? []" :key="ty.id" :value="ty.id">{{ ty.name }}</option>
      </select>
    </label>
    <p :class="HINT">
      {{
        config.mode === 'remove'
          ? t('The exercises and schedule the type brought end; exercises added by hand stay.', 'Los ejercicios y la pauta que trajo el tipo se finalizan; los añadidos a mano se quedan.')
          : t('The patient also gets the exercises and schedule this type brings, without repeating what they already have.', 'El paciente recibe también los ejercicios y la pauta que trae este tipo, sin repetir lo que ya tenga.')
      }}
    </p>
  </div>
</template>
