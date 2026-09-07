<script setup lang="ts">
const props = defineProps<{ method: string; path: string; scope?: string }>()

const TONE: Record<string, 'success' | 'brand' | 'warning' | 'danger'> = {
  GET: 'success',
  POST: 'brand',
  PATCH: 'warning',
  DELETE: 'danger',
}
const tone = computed(() => TONE[props.method] ?? 'neutral')
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UiPill :tone="tone">{{ method }}</UiPill>
    <code class="font-mono text-[13px] text-ink-900">{{ path }}</code>
    <UiPill v-if="scope" tone="neutral">{{ scope }}</UiPill>
  </div>
</template>
