<script setup lang="ts">
defineProps<{ steps: string[]; current: number }>()
</script>

<template>
  <ol class="flex items-center">
    <li v-for="(label, i) in steps" :key="label" class="flex flex-1 items-center last:flex-none">
      <div class="flex flex-col items-center gap-1.5">
        <div
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          :class="i + 1 < current ? 'bg-brand text-white' : i + 1 === current ? 'border-2 border-brand text-brand' : 'border border-line-control text-ink-muted'"
        >
          <svg v-if="i + 1 < current" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5"><path d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" /></svg>
          <span v-else>{{ i + 1 }}</span>
        </div>
        <span class="whitespace-nowrap text-xs" :class="i + 1 === current ? 'font-medium text-ink-900' : 'text-ink-muted'">{{ label }}</span>
      </div>
      <div v-if="i < steps.length - 1" class="mx-2 h-px flex-1" :class="i + 1 < current ? 'bg-brand' : 'bg-line-control'" />
    </li>
  </ol>
</template>
