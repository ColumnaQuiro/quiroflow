<script setup lang="ts">
const { toasts, dismissToast } = useToast()

function toneClasses(type: string) {
  if (type === 'error') return 'border-danger-bg2 bg-surface text-danger-text'
  if (type === 'info') return 'border-line bg-surface text-ink-700'
  return 'border-success-bg2 bg-surface text-success-text'
}
function iconClasses(type: string) {
  if (type === 'error') return 'bg-danger-bg text-danger-text'
  if (type === 'info') return 'bg-brand-tint text-brand-text'
  return 'bg-success-bg text-success-text'
}
</script>

<template>
  <div class="pointer-events-none fixed right-4 top-4 z-[200] flex w-full max-w-sm flex-col gap-2">
    <TransitionGroup name="toast" tag="div" class="flex flex-col gap-2">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex items-start gap-2.5 rounded-card border bg-surface p-3 text-[13px] shadow-popover"
        :class="toneClasses(t.type)"
      >
        <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full" :class="iconClasses(t.type)">
          <svg v-if="t.type === 'error'" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 10-2 0v4a1 1 0 002 0V6zm-1 8a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z" clip-rule="evenodd" /></svg>
          <svg v-else-if="t.type === 'info'" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0v-4a1 1 0 112 0v4zm-1-8a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5z" clip-rule="evenodd" /></svg>
          <svg v-else class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 5.29a1 1 0 010 1.415l-7.005 7a1 1 0 01-1.414 0l-3.005-3a1 1 0 111.414-1.414l2.298 2.297 6.298-6.298a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
        </span>
        <span class="flex-1 pt-0.5 text-ink-700">{{ t.message }}</span>
        <button type="button" class="shrink-0 pt-0.5 text-ink-faint2 hover:text-ink-600" @click="dismissToast(t.id)">✕</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active,
.toast-move {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
/* Removed toasts collapse in place rather than jump -- leave-active items
   drop out of flow so the ones still on screen slide up smoothly instead
   of snapping to their new position. */
.toast-leave-active {
  position: absolute;
  width: 100%;
}
</style>
