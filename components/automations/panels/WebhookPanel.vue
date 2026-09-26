<script setup lang="ts">
import { FIELD, HINT, LABEL } from '~/utils/automationUi'

// A webhook step: the person's and the event's data, POSTed to another app,
// signed when a secret is set. Not called at all in test mode.

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)
</script>

<template>
  <div class="flex flex-col gap-4">
    <label :class="LABEL">
      URL
      <input type="url" :class="FIELD" :value="config.url ?? ''" placeholder="https://hooks.zapier.com/…" data-test="webhook-url" @input="set({ url: ($event.target as HTMLInputElement).value.trim() })" />
    </label>
    <label :class="LABEL">
      {{ t('Signing secret (optional)', 'Clave de firma (opcional)') }}
      <input :class="FIELD" :value="config.secret ?? ''" autocomplete="off" @input="set({ secret: ($event.target as HTMLInputElement).value.trim() || null })" />
    </label>
    <p :class="HINT">{{ t("Sends the person's and the event's data, signed with the secret. In test mode it is not called.", 'Envía los datos de la persona y del evento, firmados. En modo prueba no se llama.') }}</p>
  </div>
</template>
