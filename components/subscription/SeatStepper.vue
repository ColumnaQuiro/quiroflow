<script setup lang="ts">
const props = defineProps<{ min?: number; max?: number }>()
const model = defineModel<number>({ required: true })

const t = useT()

const lower = computed(() => props.min ?? 0)
const upper = computed(() => props.max ?? 99)

function step(delta: number) {
  model.value = Math.min(upper.value, Math.max(lower.value, model.value + delta))
}
</script>

<template>
  <div class="flex items-center gap-0.5 rounded-ctl border border-line-control p-[3px]">
    <button
      type="button"
      :aria-label="t('Remove a seat', 'Quitar una plaza')"
      :disabled="model <= lower"
      class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center rounded-[6px] text-ink-700 outline-none hover:bg-surface-subtle focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-ink-faint lg:h-8 lg:w-8"
      @click="step(-1)"
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5">
        <path d="M3.5 8H12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
    </button>
    <span class="w-[34px] text-center font-mono text-[15px] font-semibold text-ink-900" aria-live="polite">{{ model }}</span>
    <button
      type="button"
      :aria-label="t('Add a seat', 'Añadir una plaza')"
      :disabled="model >= upper"
      class="flex h-9 touch:h-11 w-9 touch:w-11 items-center justify-center rounded-[6px] text-ink-700 outline-none hover:bg-surface-subtle focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-ink-faint lg:h-8 lg:w-8"
      @click="step(1)"
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5">
        <path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>
