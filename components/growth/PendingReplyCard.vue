<script setup lang="ts">
import type { PendingReply } from '~/composables/useGrowthReputation'

defineProps<{ pending: PendingReply; outcome: 'approved' | 'discarded' | null }>()
defineEmits<{ approve: []; discard: [] }>()

const t = useT()
</script>

<template>
  <article class="overflow-hidden rounded-card border border-brand-tintBorder bg-surface shadow-card" data-test="pending-reply">
    <!-- The review itself first. The reply underneath can only be judged
    against what it is answering, so they share one card. -->
    <div class="flex flex-col gap-1.5 border-b border-brand-tintBorder p-4">
      <div class="flex flex-wrap items-center gap-2">
        <GrowthStarRating :rating="pending.review.rating" />
        <span class="text-[12.5px] font-semibold text-ink-900">{{ pending.review.author }}</span>
        <span class="text-[11px] text-ink-muted">{{ pending.review.platform }} · {{ pending.review.location }}</span>
        <span class="rounded-pill border border-warning-border bg-warning-bg px-2 py-0.5 text-[10px] font-medium text-warning-text">
          {{ t('Mixed sentiment', 'Sentimiento mixto') }}
        </span>
      </div>
      <p class="text-[12.5px] leading-[1.5] text-ink-700">{{ pending.review.text }}</p>
      <span class="text-[10.5px] text-ink-faint">{{ pending.patientNote }}</span>
    </div>

    <div class="flex flex-col gap-2.5 bg-brand-tint p-4">
      <div class="flex items-center gap-2">
        <span class="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-brand text-[9px] font-bold text-white">AI</span>
        <span class="text-[12px] font-semibold text-brand-text">{{ t('AI drafted a reply · needs approval', 'La IA ha redactado una respuesta · requiere aprobación') }}</span>
      </div>

      <p v-if="!outcome" class="rounded-ctl border border-brand-tintBorder bg-surface px-3 py-2.5 text-[12px] leading-[1.5] text-ink-700">
        {{ pending.draft }}
      </p>

      <div v-if="!outcome" class="flex flex-wrap items-center gap-2">
        <UiBtn variant="primary" size="sm" data-test="approve-reply" @click="$emit('approve')">
          {{ t('Approve and post', 'Aprobar y publicar') }}
        </UiBtn>
        <button type="button" class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-3 text-[12px] font-medium text-ink-700 hover:bg-surface-subtle">
          {{ t('Edit', 'Editar') }}
        </button>
        <button
          type="button"
          class="flex h-8 items-center rounded-ctl border border-line-control bg-surface px-3 text-[12px] font-medium text-ink-700 hover:bg-surface-subtle"
          data-test="discard-reply"
          @click="$emit('discard')"
        >{{ t('Discard', 'Descartar') }}</button>

        <!-- Worth reading twice: left alone, this posts itself in public.
        Called out in amber rather than as grey fine print, because a reply
        going out unreviewed is the consequence of doing nothing here. -->
        <span class="ml-auto rounded-pill border border-warning-border bg-warning-bg px-2 py-0.5 text-[10.5px] font-medium text-warning-text">
          {{ pending.autoPostNote }}
        </span>
      </div>

      <p v-else class="text-[12px] text-ink-muted">
        {{ outcome === 'approved'
          ? t('Approved and posted.', 'Aprobada y publicada.')
          : t('Discarded. Nothing was posted.', 'Descartada. No se ha publicado nada.') }}
      </p>
    </div>
  </article>
</template>
