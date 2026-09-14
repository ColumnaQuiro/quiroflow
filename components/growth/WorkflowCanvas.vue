<script setup lang="ts">
import type { WorkflowNode, WorkflowNodeKind } from '~/composables/useGrowthAutomations'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '~/composables/useGrowthAutomations'

defineProps<{
  nodes: WorkflowNode[]
  edgePaths: { id: string; d: string; dashed: boolean }[]
  selectedId: string
}>()
defineEmits<{ select: [id: string] }>()

const t = useT()

// Node type is carried by colour, because the shape of a workflow is read
// before it is read in detail: indigo starts it, green is the AI acting,
// amber is a branch, grey is waiting or internal bookkeeping.
const KIND_CLASS: Record<WorkflowNodeKind, string> = {
  trigger: 'border-brand bg-brand-tint',
  message: 'border-line bg-surface',
  delay: 'border-chip-border bg-chip-bg',
  condition: 'border-warning-border bg-warning-bg',
  ai: 'border-success-border bg-success-bg',
  internal: 'border-line bg-surface',
  terminal: 'border-chip-border bg-chip-bg',
}

const EYEBROW_CLASS: Record<WorkflowNodeKind, string> = {
  trigger: 'text-brand-text',
  message: 'text-ink-faint',
  delay: 'text-ink-faint',
  condition: 'text-warning-text',
  ai: 'text-success-text',
  internal: 'text-ink-faint',
  terminal: 'text-ink-faint',
}
</script>

<template>
  <!-- Dot grid, faint: enough to read as a canvas rather than a page, not
  enough to compete with the nodes on it. -->
  <div
    class="relative overflow-auto rounded-card border border-line bg-surface-subtle shadow-card"
    style="background-image: radial-gradient(rgb(var(--color-line-control)) 1px, transparent 1px); background-size: 16px 16px;"
  >
    <div class="relative mx-auto" :style="{ width: `${CANVAS_WIDTH}px`, height: `${CANVAS_HEIGHT}px` }">
      <svg
        class="absolute inset-0 h-full w-full"
        :viewBox="`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`"
        data-test="workflow-edges"
        aria-hidden="true"
      >
        <path
          v-for="path in edgePaths"
          :key="path.id"
          :d="path.d"
          fill="none"
          stroke-width="1.5"
          class="stroke-line-controlHover"
          :stroke-dasharray="path.dashed ? '4 4' : undefined"
        />
      </svg>

      <button
        v-for="node in nodes"
        :key="node.id"
        type="button"
        class="absolute flex -translate-x-1/2 flex-col justify-center gap-0.5 rounded-card border px-3 text-left transition-shadow focus-visible:outline-none"
        :class="[
          KIND_CLASS[node.kind],
          selectedId === node.id ? 'shadow-selected ring-1 ring-brand' : 'hover:shadow-card',
          node.kind === 'delay' || node.kind === 'terminal' ? 'items-center' : '',
        ]"
        :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` }"
        :data-test="`node-${node.id}`"
        :aria-pressed="selectedId === node.id"
        @click="$emit('select', node.id)"
      >
        <span v-if="node.eyebrow" class="text-[9.5px] font-semibold uppercase tracking-[.06em]" :class="EYEBROW_CLASS[node.kind]">{{ node.eyebrow }}</span>
        <span class="text-[11.5px] font-semibold leading-[1.25] text-ink-900">{{ node.title }}</span>
        <span v-if="node.detail" class="truncate text-[10px] text-ink-muted">{{ node.detail }}</span>

        <span v-if="node.badge" class="absolute right-2 top-2 rounded-pill border border-success-border bg-success-bg px-1.5 py-px text-[9px] font-medium text-success-text">
          {{ node.badge }}
        </span>

        <!-- A condition's two exits are labelled on the node itself, so the
        branch you are looking at is named without selecting it. -->
        <span v-if="node.outputs" class="mt-1 flex gap-1.5">
          <span
            v-for="(out, i) in node.outputs"
            :key="out.label"
            class="rounded-pill border px-1.5 py-px text-[9.5px] font-medium"
            :class="i === 0 ? 'border-success-border bg-success-bg text-success-text' : 'border-chip-border bg-chip-bg text-ink-muted'"
          >{{ out.label }} · {{ out.share }}</span>
        </span>
      </button>
    </div>

    <span class="sr-only">{{ t('Workflow steps are listed in the panel beside this canvas.', 'Los pasos del flujo aparecen en el panel junto a este lienzo.') }}</span>
  </div>
</template>
