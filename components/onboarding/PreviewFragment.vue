<script setup lang="ts">
// One cropped product surface inside the right panel.
//
// Fragments are drawn WIDER than the panel and scaled slightly down, so the
// right edge runs off under the panel's own overflow. That crop is what makes
// them read as a window onto a real screen rather than as a small diagram
// floating in space -- a fragment sized to fit would look like an illustration.
withDefaults(defineProps<{ top: number; width?: number }>(), { width: 720 })
</script>

<template>
  <div
    class="absolute left-[72px] origin-top-left scale-[0.965]"
    :style="{ top: `${top}px`, width: `${width}px` }"
  >
    <div
      class="overflow-hidden rounded-card border border-line bg-surface shadow-card"
      :style="{ width: `${width}px` }"
    >
      <slot />
    </div>
  </div>
</template>
