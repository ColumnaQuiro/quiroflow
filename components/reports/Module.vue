<script setup lang="ts">
// One panel of a report. The title and description are there from the first
// paint, and only the body waits -- for its own data, not the whole page's.
// A report used to swap everything for a few anonymous grey blocks until the
// slowest query of the page came back, so nothing said what was coming and
// the quick panels sat behind the slow one.
//
// `skeleton` picks the placeholder: a chart area (`chartHeight` should be the
// class the chart itself uses, so nothing jumps when it lands) or a list of
// label/amount rows. A #skeleton slot replaces either.
withDefaults(
  defineProps<{
    title: string
    description?: string
    loading?: boolean
    skeleton?: 'chart' | 'list'
    chartHeight?: string
    rows?: number
  }>(),
  { description: undefined, loading: false, skeleton: 'chart', chartHeight: 'h-64', rows: 4 },
)
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-4 shadow-card" :aria-busy="loading || undefined" data-pdf-block :data-pdf-title="title">
    <h3 class="text-[13.5px] font-semibold text-ink-800">{{ title }}</h3>
    <p v-if="description" class="text-[12px] text-ink-faint2">{{ description }}</p>
    <template v-if="loading">
      <slot name="skeleton">
        <UiSkeleton v-if="skeleton === 'chart'" class="mt-3 w-full rounded-ctl" :class="chartHeight" />
        <div v-else class="mt-3 space-y-3">
          <div v-for="i in rows" :key="i" class="flex items-center justify-between gap-6">
            <UiSkeleton class="h-3.5 rounded-ctlSm" :style="{ width: `${30 + ((i * 23) % 35)}%` }" />
            <UiSkeleton class="h-3.5 w-16 rounded-ctlSm" />
          </div>
        </div>
      </slot>
    </template>
    <slot v-else />
  </section>
</template>
