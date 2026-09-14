<script setup lang="ts">
// Uneven column heights on purpose: a row of seven identical stacks reads as
// a grid that failed to load, where a ragged one reads as a board still
// filling in. Same 2-4 card range the real stages have.
const columns = [3, 4, 2, 3, 2, 4, 2]
</script>

<template>
  <div data-test="leads-skeleton" class="flex gap-3 overflow-x-auto px-4 pb-4 sm:px-6" aria-hidden="true">
    <div v-for="(rows, i) in columns" :key="i" class="flex w-[200px] shrink-0 animate-pulse flex-col gap-2">
      <div class="flex items-center justify-between gap-2 px-0.5">
        <UiSkeleton class="h-3 w-20 rounded-ctlSm" />
        <UiSkeleton class="h-3 w-10 rounded-ctlSm" />
      </div>
      <div class="flex flex-col gap-2">
        <div v-for="row in rows" :key="row" class="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-2.5 shadow-card">
          <UiSkeleton class="h-3 w-4/5 rounded-ctlSm" />
          <UiSkeleton class="h-2.5 w-3/5 rounded-ctlSm" />
          <UiSkeleton class="h-2.5 w-2/5 rounded-ctlSm" />
        </div>
      </div>
    </div>
  </div>
</template>
