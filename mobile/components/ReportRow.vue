<script setup lang="ts">
// One line of a report's list, where the web has a table row: what it is
// (and a second line of detail) on the left, the figure on the right. A
// table of six columns does not fit a phone, so each report chooses the two
// or three things a row is about and puts the rest in `subtitle`.
// `to` makes the row a link (a patient, an invoice); `tone` colours the value.
defineProps<{ title: string; subtitle?: string | null; value?: string | null; valueNote?: string | null; to?: string; tone?: 'default' | 'danger' | 'warning' | 'success' | 'muted' }>()
// Resolved here, not inside the template: Nuxt rewrites a resolveComponent()
// call in <script> to the component itself, but one written in a template
// expression stays a runtime lookup, and NuxtLink is not registered globally
// -- so the row rendered as an inert <nuxtlink> element and no tap went
// anywhere.
const NuxtLink = resolveComponent('NuxtLink')
const TONES = { default: 'text-ink-900', danger: 'text-danger-text', warning: 'text-warning-text', success: 'text-success-text', muted: 'text-ink-muted' } as const
</script>

<template>
  <li class="border-b border-line-divider last:border-b-0">
    <component :is="to ? NuxtLink : 'div'" :to="to" class="flex min-h-[52px] items-center gap-3 py-2.5" :class="to ? 'active:bg-surface-subtle' : ''">
      <slot name="leading" />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate text-[14.5px] font-medium text-ink-900">{{ title }}</span>
        <span v-if="subtitle" class="text-[12.5px] leading-snug text-ink-muted">{{ subtitle }}</span>
        <slot />
      </span>
      <!-- Capped, so a long note wraps under the figure instead of
           squeezing the title down to a letter or two. -->
      <span v-if="value != null || valueNote" class="flex max-w-[45%] shrink-0 flex-col items-end gap-0.5 text-right">
        <span v-if="value != null" class="font-mono text-[14.5px] font-semibold tabular-nums" :class="TONES[tone ?? 'default']">{{ value }}</span>
        <span v-if="valueNote" class="text-[11.5px] text-ink-muted">{{ valueNote }}</span>
      </span>
      <slot name="trailing" />
      <AppChevron v-if="to" dir="right" :size="16" class="shrink-0 text-ink-faint" />
    </component>
  </li>
</template>
