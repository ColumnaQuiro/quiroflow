<script setup lang="ts">
// The 15px selection dot on the right of a tile. Decorative -- the tile's own
// aria-checked is what announces the state.
defineProps<{ selected: boolean }>()
</script>

<template>
  <span
    aria-hidden="true"
    class="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full"
    :class="selected ? 'bg-brand' : 'border border-line-control'"
  >
    <svg v-if="selected" viewBox="0 0 12 12" fill="none" class="h-2.5 w-2.5 text-white">
      <path d="M2.6 6.3L4.9 8.6L9.4 3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </span>
</template>
