<script setup lang="ts">
import type { GrowthAlert } from '~/composables/useGrowthDashboard'

defineProps<{ alerts: GrowthAlert[] }>()

const t = useT()

const BOX: Record<GrowthAlert['tone'], string> = {
  negative: 'border-danger-border bg-danger-bg',
  neutral: 'border-warning-border bg-warning-bg',
}
const DOT: Record<GrowthAlert['tone'], string> = {
  negative: 'bg-danger-text',
  neutral: 'bg-warning-text',
}
const TITLE: Record<GrowthAlert['tone'], string> = {
  negative: 'text-danger-text',
  neutral: 'text-warning-text',
}
</script>

<template>
  <section class="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-[14px] shadow-card">
    <h2 class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">
      {{ t('Needs attention', 'Requiere atención') }}
    </h2>

    <div
      v-for="alert in alerts"
      :key="alert.key"
      class="flex items-start gap-2 rounded-ctl border px-2.5 py-[9px]"
      :class="BOX[alert.tone]"
    >
      <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" :class="DOT[alert.tone]" />
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="text-[11.5px] font-semibold" :class="TITLE[alert.tone]">{{ alert.title }}</span>
        <span class="text-[10.5px] text-ink-muted">{{ alert.detail }}</span>
      </div>
    </div>

    <p v-if="!alerts.length" class="text-[11.5px] text-ink-muted">
      {{ t('Nothing needs attention right now.', 'No hay nada que requiera atención ahora mismo.') }}
    </p>
  </section>
</template>
