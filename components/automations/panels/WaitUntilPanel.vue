<script setup lang="ts">
import { WAIT_EVENTS, durationText, say, waitEventDef } from '~/utils/automationCatalog'
import { FIELD, HINT, LABEL } from '~/utils/automationUi'

// Wait until something happens -- they book, reply, pay, open or click the
// email, check in -- or until the limit passes. Two ways out, drawn as two
// paths on the canvas.

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const ev = computed(() => waitEventDef(String(config.value.event ?? '')))
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)
</script>

<template>
  <div class="flex flex-col gap-4">
    <label :class="LABEL">
      {{ t('Until', 'Hasta que') }}
      <select :class="FIELD" :value="config.event" data-test="wait-event" @change="set({ event: ($event.target as HTMLSelectElement).value })">
        <option v-for="w in WAIT_EVENTS" :key="w.value" :value="w.value">{{ say(t, w.label) }}</option>
      </select>
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
