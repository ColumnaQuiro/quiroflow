<script setup lang="ts">
import { LEAD_STAGE_OPTIONS, say } from '~/utils/automationCatalog'
import { FIELD, HINT, LABEL, NOTE } from '~/utils/automationUi'

// The two lead steps (Growth): move the lead to a stage, or assign it to
// someone on the team. Only in lead automations.

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const step = computed(() => b.stepsById.value.get(props.stepId)!)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="!b.hasGrowth.value" :class="NOTE">{{ t('Lead steps are part of Growth. This one is kept as it is and runs again once Growth is on.', 'Los pasos de leads son de Growth. Este se guarda tal cual y vuelve a funcionar al activar Growth.') }}</p>
    <template v-if="step.action_type === 'lead_stage'">
      <label :class="LABEL">
        {{ t('New stage', 'Nueva etapa') }}
        <select :class="FIELD" :value="step.config.stage" :disabled="!b.hasGrowth.value" data-test="lead-stage" @change="set({ stage: ($event.target as HTMLSelectElement).value })">
          <option v-for="s in LEAD_STAGE_OPTIONS" :key="s.value" :value="s.value">{{ say(t, s.label) }}</option>
        </select>
      </label>
      <p :class="HINT">{{ t('Moving a lead to "Lost" or "Patient" ends its journey.', 'Pasar a «Perdido» o «Paciente» termina su recorrido.') }}</p>
    </template>
    <label v-else :class="LABEL">
      {{ t('Assign to', 'Asignar a') }}
      <select :class="FIELD" :value="step.config.team_member_id ?? ''" :disabled="!b.hasGrowth.value" data-test="lead-assign" @change="set({ team_member_id: ($event.target as HTMLSelectElement).value || null })">
        <option value="" disabled>{{ t('Choose…', 'Elige…') }}</option>
        <option v-for="m in b.lookup.value.members" :key="m.id" :value="m.id">{{ m.full_name }}</option>
      </select>
    </label>
  </div>
</template>
