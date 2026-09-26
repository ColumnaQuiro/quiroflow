<script setup lang="ts">
import type { Problem } from '~/utils/automationTree'

// "Something is missing before it can run": the list, each tied to its step
// where it has one. Saving it paused is always possible -- "Save as draft".

const props = defineProps<{ problems: Problem[]; draftLabel?: string | null; busy?: boolean }>()
const emit = defineEmits<{ draft: []; review: []; goto: [stepId: string | null] }>()
const t = useT()
</script>

<template>
  <UiConfirmDialog
    :title="t('Something is missing before it can run', 'Falta algo antes de activarla')"
    :confirm-label="props.draftLabel ?? t('Save as draft', 'Guardar como borrador')"
    :cancel-label="t('Review', 'Revisar')"
    :busy="busy"
    @confirm="emit('draft')"
    @cancel="emit('review')"
  >
    <ul class="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-snug text-ink-700" data-test="problems-list">
      <li v-for="(p, i) in problems" :key="i">
        {{ t(p.message[0], p.message[1]) }}
        <button v-if="p.stepId" type="button" class="ml-1 font-semibold text-brand-text underline" @click="emit('goto', p.stepId)">{{ t('Go to the step', 'Ir al paso') }}</button>
      </li>
    </ul>
  </UiConfirmDialog>
</template>
