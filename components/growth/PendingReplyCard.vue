<script setup lang="ts">
import type { ReputationReview } from '~/composables/useGrowthReputation'

const props = defineProps<{ review: ReputationReview; busy: boolean }>()
const emit = defineEmits<{ approve: [body: string | undefined]; discard: [] }>()

const t = useT()
const editing = ref(false)
const edited = ref('')

function startEditing() {
  edited.value = props.review.draftBody ?? ''
  editing.value = true
}
</script>

<template>
  <div class="flex flex-col gap-2.5 border-t border-brand-tintBorder bg-brand-tint p-4" data-test="pending-reply">
    <div class="flex items-center gap-2">
      <span class="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-brand text-[9px] font-bold text-white">AI</span>
      <span class="text-[12px] font-semibold text-brand-text">
        {{ t('Drafted by AI · needs your approval', 'Redactado por la IA · requiere tu aprobación') }}
      </span>
    </div>

    <textarea
      v-if="editing"
      v-model="edited"
      rows="4"
      class="w-full resize-none rounded-ctl border border-brand-tintBorder bg-surface px-3 py-2.5 text-[12px] leading-[1.5] text-ink-700 focus:border-brand focus:outline-none"
      data-test="edit-reply"
    />
    <p v-else class="rounded-ctl border border-brand-tintBorder bg-surface px-3 py-2.5 text-[12px] leading-[1.5] text-ink-700">
      {{ review.draftBody }}
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <UiBtn variant="primary" size="sm" :disabled="busy" data-test="approve-reply" @click="emit('approve', editing ? edited : undefined)">
        {{ t('Approve', 'Aprobar') }}
      </UiBtn>
      <button
        v-if="!editing"
        type="button"
        class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-3 text-[12px] font-medium text-ink-700 hover:bg-surface-subtle"
        data-test="edit-reply-start"
        @click="startEditing"
      >{{ t('Edit', 'Editar') }}</button>
      <button
        type="button"
        class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-3 text-[12px] font-medium text-ink-700 hover:bg-surface-subtle"
        :disabled="busy"
        data-test="discard-reply"
        @click="emit('discard')"
      >{{ t('Discard', 'Descartar') }}</button>

      <!-- The design has this posting itself after 22 hours. It does not, and
      saying so is the point: an AI sentence appearing under the clinic's name
      on a public review with nobody having read it is a decision for the
      clinic to make, not a default to inherit from a mockup. -->
      <span class="ml-auto text-[10.5px] text-ink-muted">
        {{ t('Nothing posts without your approval', 'No se publica nada sin tu aprobación') }}
      </span>
    </div>
  </div>
</template>
