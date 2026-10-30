<script setup lang="ts">
import type { GrowthAiSummary } from '~/utils/growthDashboard'

// The receptionist's month on the Growth dashboard: read from the records
// it leaves (server/utils/receptionistActivity.ts), so it says what the
// Inbox shows. It used to be drawn in the design with a book rate and an
// average reply time and fed nothing, so it never rendered.
defineProps<{ ai: GrowthAiSummary }>()

const t = useT()
</script>

<template>
  <section class="flex flex-col gap-[11px] rounded-card border border-brand-tintBorder bg-brand-tint p-4" data-test="dashboard-ai-summary">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-[7px]">
        <span class="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-brand text-[11px] font-bold text-brand-on">AI</span>
        <h2 class="text-[12.5px] font-semibold tracking-tightTitle text-brand-text">
          {{ t('AI receptionist', 'Recepcionista IA') }}
        </h2>
      </div>
      <NuxtLink to="/growth/receptionist" class="text-[11px] font-semibold text-brand-text hover:underline">{{ t('Details', 'Detalles') }} →</NuxtLink>
    </div>

    <p v-if="ai.conversations === 0" class="text-[12.5px] leading-[1.45] text-ink-muted">
      {{ t('It has not written in any conversation yet this month.', 'Todavía no ha escrito en ninguna conversación este mes.') }}
    </p>
    <p v-else class="text-[14px] leading-[1.45] text-ink-700">
      {{ t('Wrote in', 'Ha escrito en') }}
      <strong class="font-semibold">{{ ai.conversations }} {{ ai.conversations === 1 ? t('conversation', 'conversación') : t('conversations', 'conversaciones') }}</strong>
      {{ t('this month and booked or moved', 'este mes y ha reservado o movido') }}
      <strong class="font-semibold">{{ ai.booked }}</strong>
      {{ ai.booked === 1 ? t('visit on its own.', 'cita ella sola.') : t('visits on its own.', 'citas ella sola.') }}
    </p>

    <dl class="flex flex-wrap gap-[18px] border-t border-brand-tintBorder pt-[11px]">
      <div class="flex flex-col gap-0.5">
        <dd class="text-[16px] font-semibold text-ink-900">{{ ai.sent }}</dd>
        <dt class="text-[11px] text-ink-muted">{{ t('Sent itself', 'Enviadas sola') }}</dt>
      </div>
      <div class="flex flex-col gap-0.5">
        <dd class="text-[16px] font-semibold text-ink-900">{{ ai.drafted }}</dd>
        <dt class="text-[11px] text-ink-muted">{{ t('Drafted', 'Borradores') }}</dt>
      </div>
      <div class="flex flex-col gap-0.5">
        <dd class="text-[16px] font-semibold text-ink-900">{{ ai.handedOver }}</dd>
        <dt class="text-[11px] text-ink-muted">{{ t('Handed over', 'Pasadas a una persona') }}</dt>
      </div>
    </dl>
  </section>
</template>
