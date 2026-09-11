<script setup lang="ts">
// A bono, as the patient thinks of it: how many sessions are left.
//
// The old portal rendered this as one line of grey text among others
// ("Bono 12 — quedan 3 de 12 sesiones"), which is the single thing most
// patients open the portal to check. A bar makes "nearly out" visible
// without reading, and the count stays for the exact answer.
const props = defineProps<{
  name: string
  sessionsTotal: number
  sessionsUsed: number
  /** Set when the bono belongs to someone else who shares it. */
  sharedBy?: string
}>()

const t = useT()
const left = computed(() => Math.max(0, props.sessionsTotal - props.sessionsUsed))
const pct = computed(() => (props.sessionsTotal > 0 ? Math.round((left.value / props.sessionsTotal) * 100) : 0))
// Amber before it runs out, so "book your next one" lands while there is
// still a session to book.
const barTone = computed(() => (left.value === 0 ? 'bg-ink-faint' : left.value <= 2 ? 'bg-warning-accent' : 'bg-brand'))
</script>

<template>
  <div>
    <div class="flex items-baseline justify-between gap-3">
      <p class="min-w-0 truncate text-[13.5px] font-medium text-ink-900">{{ name }}</p>
      <p class="shrink-0 text-[13px] text-ink-muted">
        <span class="text-[15px] font-[640] text-ink-900">{{ left }}</span>
        {{ t(`of ${sessionsTotal} left`, `de ${sessionsTotal} restantes`) }}
      </p>
    </div>
    <div class="mt-2 h-1.5 overflow-hidden rounded-pill bg-surface-subtle">
      <div class="h-full rounded-pill transition-all" :class="barTone" :style="{ width: `${pct}%` }" />
    </div>
    <p v-if="sharedBy" class="mt-1.5 text-[12px] text-ink-faint">{{ t(`Shared by ${sharedBy}`, `Compartido por ${sharedBy}`) }}</p>
  </div>
</template>
