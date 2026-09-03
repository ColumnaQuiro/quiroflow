<script setup lang="ts">
const { toasts, dismissToast } = useToast()

function toneClasses(type: string) {
  if (type === 'error') return 'border-danger-bg2 bg-danger-bg text-danger-text'
  if (type === 'info') return 'border-line bg-surface text-ink-700'
  return 'border-success-bg2 bg-success-bg text-success-text'
}
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col items-end gap-2">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="pointer-events-auto flex items-start gap-2 rounded-card border p-3 text-[13px] shadow-card"
        :class="toneClasses(t.type)"
      >
        <span class="flex-1">{{ t.message }}</span>
        <button type="button" class="shrink-0 text-current opacity-60 hover:opacity-100" @click="dismissToast(t.id)">✕</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
