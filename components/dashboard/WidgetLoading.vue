<script setup lang="ts">
// What a widget's frame holds while the widget's own code is still arriving
// (pages/dashboard.vue loads each one on demand). The same three bars as the
// page's skeleton, so the card keeps its height until the widget draws its own.
</script>

<template>
  <div class="space-y-2.5" aria-hidden="true">
    <UiSkeleton class="h-3 w-full rounded-ctlSm" />
    <UiSkeleton class="h-3 w-4/5 rounded-ctlSm" />
    <UiSkeleton class="h-3 w-3/5 rounded-ctlSm" />
  </div>
</template>
