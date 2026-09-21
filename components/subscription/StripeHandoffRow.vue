<script setup lang="ts">
withDefaults(defineProps<{ label: string; description: string; tone?: 'default' | 'danger'; last?: boolean }>(), {
  tone: 'default',
  last: false,
})

const t = useT()
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-3 py-[13px] text-left outline-none focus-visible:bg-surface-subtle"
    :class="!last && 'border-b border-line-divider'"
  >
    <span
      class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-ctl border"
      :class="tone === 'danger' ? 'border-danger-border bg-danger-bg' : 'border-line bg-surface-subtle'"
    >
      <slot name="icon" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block text-[13.5px] font-semibold" :class="tone === 'danger' ? 'text-danger-text' : 'text-ink-900'">{{ label }}</span>
      <span class="mt-0.5 block text-[12.5px] text-ink-muted">{{ description }}</span>
    </span>
    <span class="sr-only">{{ t('(opens Stripe in a new tab)', '(abre Stripe en una pestaña nueva)') }}</span>
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-ink-faint">
      <path d="M6 3.4h6.6V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M12.6 3.4L4.2 11.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  </button>
</template>
