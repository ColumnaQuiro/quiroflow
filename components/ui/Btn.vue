<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'ghost'; size?: 'md' | 'sm' }>(), {
  variant: 'secondary',
  size: 'md',
})
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl font-medium disabled:cursor-not-allowed disabled:opacity-50"
    :class="[
      size === 'md' ? 'h-8 px-3.5 text-[13px]' : 'h-[26px] px-2.5 text-[12.5px]',
      variant === 'primary' && 'border border-brand bg-brand font-semibold text-white hover:bg-brand-hover',
      variant === 'secondary' && 'border border-line-control bg-surface text-ink-500 hover:border-line-controlHover',
      variant === 'ghost' && 'border border-transparent text-ink-muted2 hover:bg-surface-subtle',
    ]"
  >
    <slot />
  </button>
</template>
