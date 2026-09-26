<script setup lang="ts">
import { DEFAULT_QUIET_HOURS, quietHoursText } from '~/utils/automationCatalog'
import { HINT, LABEL } from '~/utils/automationUi'

// Wait a while before the next step. Since the automation engine, this
// waits for patients as it always did for leads.

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const quiet = computed(() => b.draft.value.rule.quiet_hours)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div :class="LABEL">
      {{ t('Wait for', 'Esperar') }}
      <AutomationsDurationInput :model-value="Number(config.delay_minutes) || 1440" :label="t('Wait for', 'Esperar')" test-id="delay-config" @update:model-value="b.updateStepConfig(stepId, { delay_minutes: $event })" />
    </div>
    <p :class="HINT">
      {{ t('Steps are checked every 15 minutes, so a wait shorter than that happens at the next check. Anything that must arrive seconds apart should be steps with no wait between them.', 'Los pasos se comprueban cada 15 minutos, así que una espera menor ocurre en la siguiente comprobación. Lo que deba llegar con segundos de diferencia deben ser pasos seguidos sin espera.') }}
    </p>
    <label class="flex items-start gap-2.5 text-[13px] text-ink-700 touch:min-h-11">
      <input
        type="checkbox"
        class="mt-0.5 h-4 w-4 accent-brand"
        :checked="!!quiet"
        data-test="delay-quiet-hours"
        @change="b.updateRule({ quiet_hours: ($event.target as HTMLInputElement).checked ? { ...DEFAULT_QUIET_HOURS } : null })"
      />
      <span>
        {{ quiet ? quietHoursText(t, quiet) : quietHoursText(t, DEFAULT_QUIET_HOURS) }} · {{ t('only continue in these hours (clinic time)', 'solo continuar en este horario (hora de la sede)') }}
        <span class="block text-[12px] text-ink-muted">{{ t('If the wait ends at night, the next message goes out when the window opens. Applies to the whole automation (Settings).', 'Si la espera acaba de noche, el siguiente mensaje sale cuando abre el horario. Se aplica a toda la automatización (Ajustes).') }}</span>
      </span>
    </label>
  </div>
</template>
