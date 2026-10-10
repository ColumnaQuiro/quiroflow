<script setup lang="ts">
import { WAIT_EVENTS, durationText, say, waitEventDef } from '~/utils/automationCatalog'
import { FIELD, HINT, LABEL } from '~/utils/automationUi'
import { formsSentBefore } from '~/utils/automationTree'

// Wait until something happens -- they book, reply, pay, open or click the
// email, check in -- or until the limit passes. Two ways out, drawn as two
// paths on the canvas.

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const ev = computed(() => waitEventDef(String(config.value.event ?? '')))
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)
// A lead has no forms: they are sent to patients only.
const events = computed(() => WAIT_EVENTS.filter((w) => !(b.isLead.value && w.value === 'doc.completed')))

// Which form: the ones sent earlier in this automation come first, since
// that is what it is nearly always waiting for.
const sentForms = computed(() => formsSentBefore(b.draft.value.steps, props.stepId))
const formOptions = computed(() => [...b.docTemplates.value].sort((x, y) => Number(sentForms.value.includes(y.id)) - Number(sentForms.value.includes(x.id))))
function setEvent(event: string) {
  // Waiting for "a form" right after sending one means that one.
  if (event === 'doc.completed' && !config.value.doc_template_id && sentForms.value.length === 1) set({ event, doc_template_id: sentForms.value[0] })
  else set({ event, ...(event === 'doc.completed' ? {} : { doc_template_id: undefined }) })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <label :class="LABEL">
      {{ t('Until', 'Hasta que') }}
      <select :class="FIELD" :value="config.event" data-test="wait-event" @change="setEvent(($event.target as HTMLSelectElement).value)">
        <option v-for="w in events" :key="w.value" :value="w.value">{{ say(t, w.label) }}</option>
      </select>
    </label>
    <label v-if="config.event === 'doc.completed'" :class="LABEL">
      {{ t('Which form', 'Qué formulario') }}
      <select :class="FIELD" :value="config.doc_template_id ?? ''" data-test="wait-doc" @change="set({ doc_template_id: ($event.target as HTMLSelectElement).value || undefined })">
        <option value="">{{ t('Any form', 'Cualquier formulario') }}</option>
        <option v-for="d in formOptions" :key="d.id" :value="d.id">{{ d.title }}</option>
      </select>
      <span :class="HINT">{{ t('Only a copy sent after they entered this automation counts.', 'Solo cuenta una copia enviada después de que entrara en esta automatización.') }}</span>
    </label>
    <div :class="LABEL">
      {{ t('At most', 'Como mucho') }}
      <AutomationsDurationInput :model-value="Number(config.timeout_minutes) || 0" :label="t('At most', 'Como mucho')" test-id="wait-timeout" @update:model-value="set({ timeout_minutes: $event })" />
    </div>
    <p v-if="ev" :class="HINT">
      {{ t('Two ways out:', 'Dos salidas:') }}
      <strong>{{ say(t, ev.met) }}</strong>
      {{ t('and', 'y') }}
      <strong>{{ say(t, ev.timeoutPrefix) }} {{ durationText(t, Number(config.timeout_minutes) || 0) }}</strong>.
    </p>
  </div>
</template>
