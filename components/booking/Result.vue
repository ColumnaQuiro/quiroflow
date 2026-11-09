<script setup lang="ts">
// The one panel a patient lands on at the end of something: the booking made,
// a card asked for, a payment back from Stripe, a card saved, an email being
// confirmed. These were centred paragraphs on the bare page (or a "✓" typed
// into a circle), which on a phone read as a page that had not finished
// loading. A white card with a drawn status icon says it has, and which way it
// went, before a word is read.
withDefaults(defineProps<{ tone?: 'success' | 'danger' | 'neutral' | 'pending'; title: string }>(), { tone: 'success' })
</script>

<template>
  <div class="mx-auto w-full max-w-md rounded-card border border-line bg-surface px-6 py-8 text-center shadow-card">
    <div
      class="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
      :class="{
        'bg-success-bg text-success-text': tone === 'success',
        'bg-danger-bg text-danger-text': tone === 'danger',
        'bg-chip-bg text-ink-muted': tone === 'neutral',
        'bg-brand-tint text-brand-text': tone === 'pending',
      }"
    >
      <svg v-if="tone === 'pending'" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-5 w-5 animate-spin">
        <circle cx="8" cy="8" r="6.1" stroke="currentColor" stroke-width="1.6" class="opacity-35" />
        <path d="M8 1.9A6.1 6.1 0 0 1 14.1 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" class="h-6 w-6">
        <path v-if="tone === 'success'" stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        <path v-else-if="tone === 'danger'" stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        <path v-else stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
    </div>
    <h2 class="mt-4 text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ title }}</h2>
    <div class="mt-2 text-[13px] leading-[1.55] text-ink-muted">
      <slot />
    </div>
    <div v-if="$slots.actions" class="mt-5 flex flex-col gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
