<script setup lang="ts">
import { OUTLETS, say, stepDef, triggerDef } from '~/utils/automationCatalog'
import { stepEyebrow, stepTitle } from '~/utils/automationDescribe'
import { subtreeIds } from '~/utils/automationTree'

// The selected step's panel: on the right beside the canvas on a wide
// screen, a sheet from the bottom on a tablet (the page decides which).

const props = defineProps<{ sheet?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const b = useBuilder()
const t = useT()

const sel = computed(() => b.selection.value)
const step = computed(() => (sel.value?.kind === 'step' ? (b.stepsById.value.get(sel.value.id) ?? null) : null))

const eyebrow = computed(() => {
  if (sel.value?.kind === 'trigger') {
    const r = b.draft.value.rule
    if (r.trigger_event === 'segment') return t('Trigger · a group', 'Disparador · un segmento')
    if (b.isLead.value) return t('Trigger · leads', 'Disparador · leads')
    return t('Trigger · an event', 'Disparador · un evento')
  }
  if (step.value) return stepEyebrow(t, step.value.action_type)
  if (sel.value?.kind === 'insert') {
    const p = sel.value.point
    const name = (id: string | null) => {
      if (!id) return p.parentId ? stepTitle(t, b.stepsById.value.get(p.parentId)!, b.lookup.value) : t('the trigger', 'el disparador')
      return stepTitle(t, b.stepsById.value.get(id)!, b.lookup.value)
    }
    return p.beforeId ? t(`Between "${name(p.afterId)}" and "${name(p.beforeId)}"`, `Entre «${name(p.afterId)}» y «${name(p.beforeId)}»`) : t(`After "${name(p.afterId)}"`, `Después de «${name(p.afterId)}»`)
  }
  return ''
})
const title = computed(() => {
  if (sel.value?.kind === 'trigger') {
    const def = triggerDef(b.draft.value.rule.trigger_event)
    return b.draft.value.rule.trigger_event === 'segment' ? b.draft.value.rule.name : def ? say(t, def.label) : ''
  }
  if (step.value) return stepTitle(t, step.value, b.lookup.value)
  if (sel.value?.kind === 'insert') return t('Add a step', 'Añadir un paso')
  return ''
})

const stepProblems = computed(() => {
  if (sel.value?.kind === 'trigger') return b.problems.value.filter((p) => !p.stepId)
  if (step.value) return b.problems.value.filter((p) => p.stepId === step.value!.id)
  return []
})

// Removing a step that has paths under it takes them too; say so first.
const confirmRemove = ref(false)
const below = computed(() => (step.value ? subtreeIds(b.draft.value.steps, step.value.id).size - 1 : 0))
function remove() {
  if (!step.value) return
  if (below.value > 0 && !confirmRemove.value) {
    confirmRemove.value = true
    return
  }
  confirmRemove.value = false
  b.removeStep(step.value.id)
}
watch(sel, () => (confirmRemove.value = false))

const canDuplicate = computed(() => step.value && !OUTLETS[step.value.action_type])
const lockedLeadStep = computed(() => !!step.value && !!stepDef(step.value.action_type)?.leadOnly && !b.hasGrowth.value)
function pick(type: string) {
  if (sel.value?.kind === 'insert') b.addStep(sel.value.point, type)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-test="inspector">
    <div class="flex items-start justify-between gap-3 border-b border-line-divider px-5 py-3.5">
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="truncate text-[10.5px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ eyebrow }}</span>
        <strong class="truncate text-[15px] text-ink-900" data-test="inspector-title">{{ title }}</strong>
      </div>
      <button
        v-if="sheet"
        type="button"
        class="h-9 shrink-0 rounded-ctl bg-brand px-4 text-[13px] font-semibold text-surface hover:bg-brand-hover touch:h-11"
        data-test="inspector-done"
        @click="emit('close')"
      >{{ t('Done', 'Hecho') }}</button>
      <button
        v-else
        type="button"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle touch:h-11 touch:w-11"
        :aria-label="t('Close', 'Cerrar')"
        @click="emit('close')"
      >✕</button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <ul v-if="stepProblems.length" class="mb-4 flex flex-col gap-1 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2.5 text-[12.5px] text-warning-text" data-test="inspector-problems">
        <li v-for="(p, i) in stepProblems" :key="i">{{ t(p.message[0], p.message[1]) }}</li>
      </ul>

      <AutomationsTriggerPanel v-if="sel?.kind === 'trigger'" />
      <template v-else-if="step">
        <AutomationsPanelsWhatsAppPanel v-if="step.action_type === 'whatsapp_template'" :key="step.id" :step-id="step.id" />
        <AutomationsPanelsEmailPanel v-else-if="step.action_type === 'email'" :key="`e-${step.id}`" :step-id="step.id" />
        <AutomationsPanelsWebhookPanel v-else-if="step.action_type === 'webhook'" :step-id="step.id" />
        <AutomationsPanelsDelayPanel v-else-if="step.action_type === 'delay'" :key="`d-${step.id}`" :step-id="step.id" />
        <AutomationsPanelsWaitUntilPanel v-else-if="step.action_type === 'wait_until'" :key="`w-${step.id}`" :step-id="step.id" />
        <AutomationsPanelsBranchPanel v-else-if="step.action_type === 'branch'" :step-id="step.id" />
        <AutomationsPanelsTagPanel v-else-if="step.action_type === 'tag'" :step-id="step.id" />
        <AutomationsPanelsNotifyPanel v-else-if="step.action_type === 'notify'" :step-id="step.id" />
        <AutomationsPanelsLeadPanel v-else-if="step.action_type === 'lead_stage' || step.action_type === 'lead_assign'" :step-id="step.id" />
        <AutomationsMessageStats
          v-if="step.action_type === 'whatsapp_template' && b.stats.value.steps[step.id]"
          class="mt-4"
          channel="whatsapp"
          :stats="b.stats.value.steps[step.id]!.whatsapp"
          :hidden="!b.canReadWhatsApp.value"
          test-id="step-whatsapp-stats"
        />
        <AutomationsMessageStats
          v-if="step.action_type === 'email' && b.stats.value.steps[step.id]"
          class="mt-4"
          channel="email"
          :stats="b.stats.value.steps[step.id]!.email"
          test-id="step-email-stats"
        />
      </template>
      <template v-else-if="sel?.kind === 'insert'">
        <p class="text-[13px] leading-snug text-ink-500">
          {{ t('Choose what happens next. Lead steps need Growth and are only offered in lead automations.', 'Elige qué pasa a continuación. Los pasos de leads necesitan Growth y solo se ofrecen en automatizaciones de leads.') }}
        </p>
        <AutomationsAddStepMenu v-if="sheet" class="mt-3 w-full max-w-none" :is-lead="b.isLead.value" :has-growth="b.hasGrowth.value" @pick="pick" @close="emit('close')" />
      </template>
      <p v-else class="text-[13px] text-ink-muted">{{ t('Select a step on the canvas to edit it, or a "+" to add one.', 'Selecciona un paso del lienzo para editarlo, o un «+» para añadir uno.') }}</p>
    </div>

    <div v-if="step" class="flex flex-wrap items-center justify-between gap-2 border-t border-line-divider px-5 py-3">
      <UiBtn v-if="canDuplicate && !lockedLeadStep" variant="secondary" data-test="step-duplicate" @click="b.duplicateStep(step.id)">{{ t('Duplicate', 'Duplicar') }}</UiBtn>
      <span v-else />
      <span v-if="confirmRemove" class="text-[12px] text-danger-text">{{ t(`Also removes the ${below} step(s) in its paths.`, `También elimina los ${below} pasos de sus ramas.`) }}</span>
      <button
        type="button"
        class="h-9 rounded-ctl border border-danger-border bg-surface px-3.5 text-[13px] font-semibold text-danger-text hover:bg-danger-bg touch:h-11"
        data-test="step-remove"
        @click="remove"
      >{{ confirmRemove ? t('Remove all', 'Eliminar todo') : t('Remove step', 'Eliminar paso') }}</button>
    </div>
  </div>
</template>
