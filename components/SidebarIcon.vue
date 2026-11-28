<script setup lang="ts">
// One sidebar icon: a line drawing on a 24-unit grid (the paths live in
// composables/useSidebarNavItems.ts). The page you are on gets a solid tile in
// the brand colour instead of a tinted row -- it is the one mark that still
// says "you are here" with the sidebar collapsed to icons. Every icon sits in
// the same 23px box, tile or not, so the labels do not move when it appears.
defineProps<{ path: string; active?: boolean }>()
</script>

<template>
  <span
    class="flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-[6px]"
    :class="active ? 'bg-brand text-brand-on' : ''"
    data-cy="sidebar-icon"
    :data-active="active ? 'true' : undefined"
    aria-hidden="true"
  >
    <svg
      :width="active ? 14 : 18"
      :height="active ? 14 : 18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      :stroke-width="active ? 2.1 : 1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    ><path :d="path" /></svg>
  </span>
</template>
