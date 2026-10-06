<script setup lang="ts">
// The app's one arrow: the same chevron as the back buttons (calendar/[id],
// the agenda's day bar), in place of the ← → › characters that each font drew
// differently.
withDefaults(defineProps<{ dir?: 'left' | 'right' | 'down'; size?: number }>(), { dir: 'right', size: 14 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="inline-block shrink-0 align-[-0.125em]"
  >
    <path v-if="dir === 'left'" d="M15 6l-6 6 6 6" />
    <path v-else-if="dir === 'down'" d="M6 9l6 6 6-6" />
    <path v-else d="M9 6l6 6-6 6" />
  </svg>
</template>
