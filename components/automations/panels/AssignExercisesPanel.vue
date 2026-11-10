<script setup lang="ts">
import { FIELD, HINT, LABEL, SEGMENT_WRAP, segmentBtn } from '~/utils/automationUi'

// Assign home exercises: a programme from the library, or a schedule by
// visit. An exercise the patient already has is not given twice, and a
// schedule is only started for someone who is not already following one.
const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)
const mode = computed(() => (config.value.kind === 'schedule' || config.value.schedule_id ? 'schedule' : 'program'))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div :class="SEGMENT_WRAP" role="group">
      <button type="button" :class="segmentBtn(mode === 'program')" :aria-pressed="mode === 'program'" @click="set({ kind: 'program', schedule_id: null })">{{ t('Programme', 'Programa') }}</button>
      <button type="button" :class="segmentBtn(mode === 'schedule')" :aria-pressed="mode === 'schedule'" data-test="assign-exercises-schedule-mode" @click="set({ kind: 'schedule', program_id: null })">{{ t('Schedule by visit', 'Pauta por visita') }}</button>
    </div>
    <label v-if="mode === 'program'" :class="LABEL">
      {{ t('Programme', 'Programa') }}
      <select :class="FIELD" :value="config.program_id ?? ''" data-test="assign-exercises-program" @change="set({ program_id: ($event.target as HTMLSelectElement).value || null })">
        <option value="">{{ t('Choose a programme…', 'Elige un programa…') }}</option>
        <option v-for="p in b.lookup.value.exercisePrograms ?? []" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </label>
    <label v-else :class="LABEL">
      {{ t('Schedule', 'Pauta') }}
      <select :class="FIELD" :value="config.schedule_id ?? ''" data-test="assign-exercises-schedule" @change="set({ schedule_id: ($event.target as HTMLSelectElement).value || null })">
        <option value="">{{ t('Choose a schedule…', 'Elige una pauta…') }}</option>
        <option v-for="s in b.lookup.value.exerciseSchedules ?? []" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </label>
    <p :class="HINT">{{ t('The patient gets a notification in the app, as when a practitioner assigns them.', 'El paciente recibe un aviso en la app, como cuando se los asigna un profesional.') }}</p>
  </div>
</template>
