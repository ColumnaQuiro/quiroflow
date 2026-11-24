<script setup lang="ts">
import { isLeadAtom, type TriggerAtom } from '~/utils/automationTrigger'
import { atomTitle } from '~/utils/automationTriggerText'
import { filtersText, type NameLookup } from '~/utils/automationDescribe'

// Switching an automation on, said before it happens: from now on, who enters
// it and on what; who is already inside and carries on; and whether it really
// sends (test mode, marketing consent). A group (segment) has its own dialog,
// AutomationsSegmentActivateDialog, which can count who matches today; an
// event trigger has nobody to count yet, so this says what will start it.
// Pausing needs no dialog: it is always safe and switching back on resumes.

const props = defineProps<{
  name: string
  trigger: TriggerAtom
  filters: Record<string, any> | null | undefined
  lookup: NameLookup
  isMarketing: boolean
  dryRun: boolean
  /** People inside it now -- paused, they wait at their step and resume. */
  inside: number
  busy?: boolean
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const t = useT()

const when = computed(() => {
  const detail = filtersText(t, props.filters, props.lookup)
  const head = atomTitle(t, props.trigger, props.filters)
  return detail ? `${head} · ${detail}` : head
})
const lead = computed(() => isLeadAtom(props.trigger))
const title = computed(() => t(`Switch on "${props.name}"?`, `¿Activar «${props.name}»?`))
</script>

<template>
  <UiConfirmDialog
    :title="title"
    :confirm-label="t('Switch on', 'Activar')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :busy="busy"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  >
    <div class="flex flex-col gap-3 text-[14px] leading-relaxed text-ink-500" data-test="activate-dialog">
      <p>
        {{ lead
          ? t('From now on, every new lead that meets this enters and receives its steps:', 'A partir de ahora, cada lead nuevo que cumpla esto entra y recibe sus pasos:')
          : t('From now on, every patient who meets this enters and receives its steps:', 'A partir de ahora, cada paciente que cumpla esto entra y recibe sus pasos:') }}
      </p>
      <p class="rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 font-semibold text-ink-900" data-test="activate-when">{{ when }}</p>
      <p v-if="inside > 0" data-test="activate-inside">
        <strong class="text-ink-900">{{ inside === 1 ? t('1 person', '1 persona') : t(`${inside} people`, `${inside} personas`) }}</strong>
        {{ inside === 1
          ? t('already inside carries on from the step where it stopped.', 'que ya estaba dentro sigue desde el paso en que se quedó.')
          : t('already inside carry on from the step where they stopped.', 'que ya estaban dentro siguen desde el paso en que se quedaron.') }}
      </p>
      <p v-if="dryRun" class="rounded-ctl border border-info-border bg-info-bg px-3 py-2.5 text-[13px] text-info-text" data-test="activate-test-mode">
        {{ t('Test mode: nothing is sent to anyone. What would have been sent is recorded so you can check it.', 'Modo prueba: no se envía nada a nadie. Queda registrado lo que se habría enviado para que lo revises.') }}
      </p>
      <p v-else-if="isMarketing" class="text-[13px]" data-test="activate-marketing">
        {{ t('It is marketing: each channel only reaches people who accepted it.', 'Es comercial: cada canal solo llega a quien lo aceptó.') }}
      </p>
    </div>
  </UiConfirmDialog>
</template>
