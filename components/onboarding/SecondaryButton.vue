<script setup lang="ts">
withDefaults(defineProps<{ type?: 'submit' | 'button'; disabled?: boolean }>(), {
  type: 'button',
  disabled: false,
})
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="flex h-[46px] items-center justify-center rounded-ctl border border-line-control bg-surface px-[18px] text-[15px] font-semibold text-ink-700 outline-none hover:border-line-controlHover focus-visible:shadow-focus disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-ink-faint lg:h-10 lg:px-4 lg:text-[14.5px]"
  >
    <slot />
  </button>
</template>
