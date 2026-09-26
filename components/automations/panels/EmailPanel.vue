<script setup lang="ts">
import { EMAIL_MERGE_FIELDS, say } from '~/utils/automationCatalog'
import { FIELD, HINT, LABEL, NOTE } from '~/utils/automationUi'

// An email step: subject and body, with the patient's details as merge fields
// ({{first_name}} and the rest, resolved per recipient when it is sent).

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)
</script>

<template>
  <div class="flex flex-col gap-4">
    <label :class="LABEL">
      {{ t('Subject', 'Asunto') }}
      <input :class="FIELD" :value="config.subject ?? ''" :placeholder="t('Subject — {{first_name}} works here too', 'Asunto — {{first_name}} también funciona aquí')" data-test="email-subject" @input="set({ subject: ($event.target as HTMLInputElement).value })" />
    </label>
    <div :class="LABEL">
      {{ t('Message', 'Mensaje') }}
      <AutomationsRichTextEditor :key="stepId" :model-value="config.body ?? ''" :variables="EMAIL_MERGE_FIELDS.map((f) => ({ key: f.value, label: say(t, f.label) }))" @update:model-value="set({ body: $event })" />
    </div>
    <p :class="HINT">{{ t('Click a field to insert it where the cursor is. It is filled in for each patient when the email goes out.', 'Pulsa un campo para insertarlo donde está el cursor. Se rellena con los datos de cada paciente al enviar.') }}</p>
    <p v-if="b.draft.value.rule.is_marketing" :class="NOTE">{{ t('This automation is marketing: only patients who accepted marketing email receive it.', 'Esta automatización es comercial: solo la reciben los pacientes que aceptaron email comercial.') }}</p>
  </div>
</template>
