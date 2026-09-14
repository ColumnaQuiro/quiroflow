<script setup lang="ts">
import type { GrowthLead } from '~/composables/useGrowthLeads'

defineProps<{ lead: GrowthLead; dragging?: boolean }>()
defineEmits<{ open: []; dragstart: []; dragend: [] }>()

const t = useT()
</script>

<template>
  <!-- A button, not a div with @click: the board is a list of records that
  open a drawer, and the keyboard has to reach them. draggable coexists with
  that -- pointer users drag between stages, keyboard users use the stage
  selector inside the drawer. -->
  <button
    type="button"
    draggable="true"
    class="flex w-full flex-col gap-1.5 rounded-card border bg-surface p-2.5 text-left shadow-card transition-opacity hover:border-brand-tintBorder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    :class="dragging ? 'border-brand-tintBorder opacity-40' : 'border-line'"
    @click="$emit('open')"
    @dragstart="$emit('dragstart')"
    @dragend="$emit('dragend')"
  >
    <div class="flex items-start justify-between gap-1.5">
      <span class="text-[11.5px] font-semibold leading-[1.25] tracking-tightTitle text-ink-900">{{ lead.name }}</span>
      <span class="shrink-0 rounded-ctlSm border border-chip-border px-1 py-px font-mono text-[8.5px] font-medium text-ink-muted">{{ lead.channel }}</span>
    </div>

    <div class="flex flex-wrap gap-1">
      <span class="rounded-pill border border-chip-border bg-chip-bg px-1.5 py-px text-[9.5px] text-ink-muted">{{ lead.source }}</span>
      <span v-if="lead.aiHandling" class="rounded-pill bg-brand px-1.5 py-px text-[9.5px] font-semibold text-white">
        {{ t('AI handling', 'IA gestionando') }}
      </span>
    </div>

    <div v-if="lead.appointment" class="rounded-ctlSm border border-success-border bg-success-bg px-1.5 py-[3px] text-[9.5px] leading-[1.3] text-success-text">
      {{ lead.appointment }}
    </div>

    <div class="flex items-center justify-between gap-1 text-[9.5px] text-ink-faint">
      <span>{{ lead.timeInStage }}</span>
      <span class="font-mono">{{ lead.value }}</span>
    </div>
  </button>
</template>
