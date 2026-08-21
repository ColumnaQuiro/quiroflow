<script setup lang="ts">
withDefaults(defineProps<{ label: string; helper?: string; align?: 'center' | 'top' }>(), {
  align: 'center',
})
</script>

<template>
  <div class="flex gap-6 rounded-card border border-line bg-surface p-4 shadow-card" :class="align === 'top' ? 'items-start' : 'items-center'">
    <div class="min-w-0 flex-1 pr-4">
      <p class="text-[13.5px] font-[560] text-ink-700">{{ label }}</p>
      <p v-if="helper || $slots.helper" class="mt-1 text-[12.5px] leading-[1.5] text-ink-muted2">
        <slot name="helper">{{ helper }}</slot>
      </p>
    </div>
    <div class="shrink-0">
      <slot />
    </div>
  </div>
</template>
