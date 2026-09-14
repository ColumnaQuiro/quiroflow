<script setup lang="ts">
import type { GrowthAiSummary } from '~/composables/useGrowthDashboard'

defineProps<{ ai: GrowthAiSummary }>()

const t = useT()
</script>

<template>
  <section class="flex flex-col gap-[11px] rounded-card border border-brand-tintBorder bg-brand-tint p-4">
    <div class="flex items-center gap-[7px]">
      <span class="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] bg-brand text-[9px] font-bold text-white">AI</span>
      <h2 class="text-[12.5px] font-semibold tracking-tightTitle text-brand-text">
        {{ t('AI receptionist', 'Recepcionista IA') }}
      </h2>
    </div>

    <p class="text-[14px] leading-[1.45] text-ink-700">
      {{ t('Handled', 'Ha gestionado') }}
      <strong class="font-semibold">{{ ai.conversations }} {{ t('conversations', 'conversaciones') }}</strong>
      {{ t('this month and booked', 'este mes y ha reservado') }}
      <strong class="font-semibold">{{ ai.booked }}</strong>
      {{ t('of them into the calendar.', 'de ellas en el calendario.') }}
    </p>

    <dl class="flex gap-[18px] border-t border-brand-tintBorder pt-[11px]">
      <div class="flex flex-col gap-0.5">
        <dd class="text-[16px] font-semibold text-ink-900">{{ ai.bookRate }}</dd>
        <dt class="text-[10px] text-ink-muted">{{ t('Book rate', 'Tasa de reserva') }}</dt>
      </div>
      <div class="flex flex-col gap-0.5">
        <dd class="text-[16px] font-semibold text-ink-900">{{ ai.avgReply }}</dd>
        <dt class="text-[10px] text-ink-muted">{{ t('Avg reply', 'Respuesta media') }}</dt>
      </div>
      <div class="flex flex-col gap-0.5">
        <dd class="text-[16px] font-semibold text-ink-900">{{ ai.escalated }}</dd>
        <dt class="text-[10px] text-ink-muted">{{ t('Escalated', 'Escaladas') }}</dt>
      </div>
    </dl>
  </section>
</template>
