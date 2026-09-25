<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'primary' | 'secondary' | 'ghost'; size?: 'lg' | 'md' | 'sm' }>(), {
  variant: 'secondary',
  size: 'md',
})
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl font-medium disabled:cursor-not-allowed disabled:opacity-50"
    :class="[
      // The site's scale (tailwind.tokens.ts, touchVariant): md is the
      // standard control, 36px under a mouse; sm the compact one, 32px. Both
      // grow on a touch screen. lg is 44px everywhere, for the buttons a thumb
      // aims at in the app.
      size === 'lg' ? 'h-11 px-4 text-[14px]' : size === 'md' ? 'h-9 px-3.5 text-[13px] touch:h-11' : 'h-8 px-2.5 text-[12.5px] touch:h-10',
      variant === 'primary' && 'border border-brand bg-brand font-semibold text-white hover:bg-brand-hover',
      variant === 'secondary' && 'border border-line-control bg-surface text-ink-500 hover:border-line-controlHover',
      variant === 'ghost' && 'border border-transparent text-ink-muted2 hover:bg-surface-subtle',
    ]"
  >
    <slot />
  </button>
</template>
