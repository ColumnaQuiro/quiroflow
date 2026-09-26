<script setup lang="ts">
import { say, stepDef } from '~/utils/automationCatalog'

// Saving a change that removes a step people are parked on: move them on to
// what now follows it, or take them out. Everyone else stays where they are.

const props = defineProps<{ people: { stepId: string; actionType: string; count: number }[]; titles: Record<string, string>; busy?: boolean }>()
const emit = defineEmits<{ confirm: [policy: 'move_on' | 'take_out']; cancel: [] }>()
const t = useT()
const policy = ref<'move_on' | 'take_out'>('move_on')
const total = computed(() => props.people.reduce((n, p) => n + p.count, 0))
const name = (p: { stepId: string; actionType: string }) => props.titles[p.stepId] ?? say(t, stepDef(p.actionType)?.label ?? [p.actionType, p.actionType])
</script>

<template>
  <UiConfirmDialog
    :title="t('Save changes with people inside', 'Guardar cambios con gente dentro')"
    :confirm-label="t('Save', 'Guardar')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :busy="busy"
    @confirm="emit('confirm', policy)"
    @cancel="emit('cancel')"
  >
    <p class="text-[14px] leading-relaxed text-ink-500" data-test="removed-steps-summary">
      <template v-for="(p, i) in people" :key="p.stepId">
        {{ i > 0 ? ' ' : '' }}{{ t(`You removed the step "${name(p)}", where there ${p.count === 1 ? 'is' : 'are'}`, `Has quitado el paso «${name(p)}», donde hay`) }}
        <strong>{{ t(`${p.count} ${p.count === 1 ? 'person' : 'people'}`, `${p.count} ${p.count === 1 ? 'persona' : 'personas'}`) }}</strong>.
      </template>
    </p>
    <div class="flex flex-col gap-1" role="radiogroup">
      <label class="flex items-center gap-2 text-[14px] text-ink-700 touch:min-h-11">
        <input v-model="policy" type="radio" value="move_on" class="h-4 w-4 accent-brand" data-test="removed-move-on" />
        {{ total === 1 ? t('They move on to the next step', 'Pasa al paso siguiente') : t('They move on to the next step', 'Pasan al paso siguiente') }}
      </label>
      <label class="flex items-center gap-2 text-[14px] text-ink-700 touch:min-h-11">
        <input v-model="policy" type="radio" value="take_out" class="h-4 w-4 accent-brand" data-test="removed-take-out" />
        {{ total === 1 ? t('They leave the automation', 'Sale de la automatización') : t('They leave the automation', 'Salen de la automatización') }}
      </label>
    </div>
    <p class="text-[13px] text-ink-muted">{{ t('Everyone else stays where they were, with the new steps.', 'Los demás siguen donde estaban con los pasos nuevos.') }}</p>
  </UiConfirmDialog>
</template>
