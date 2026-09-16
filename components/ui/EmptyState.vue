<script setup lang="ts">
// The one empty state, so there stops being thirty-eight of them.
//
// Almost every screen in this app has its own: a centred paragraph in
// text-ink-muted, sometimes a heading, occasionally a button, each spaced
// slightly differently. They read as a screen that failed to load rather than
// a screen with nothing in it yet -- which matters most on exactly the screens
// a clinic sees first, when everything is empty because they have just
// arrived.
//
// Shaped after LeadsEmptyState, which already got this right: an icon tile, a
// title, a sentence that says what will fill this and what to do about it,
// and the action itself. Generalised rather than copied so the next one is a
// component call instead of forty lines of divs.
//
// `tone` is the whole reason this is not just a slot. "Nothing yet" and "not
// built yet" are different promises and should not look identical: the first
// is an invitation, the second is a roadmap, and a clinic being sold the
// product needs to tell them apart at a glance.

interface Props {
  /** A short label; shows as a chip when tone is 'soon'. */
  eyebrow?: string
  title: string
  description?: string
  tone?: 'neutral' | 'soon'
}

const props = withDefaults(defineProps<Props>(), { tone: 'neutral' })

const isSoon = computed(() => props.tone === 'soon')
</script>

<template>
  <div class="flex justify-center px-4 py-12" data-test="empty-state">
    <!-- The soft panel is what stops this reading as a failed load. A plain
    centred paragraph on the page background looks like something that should
    have rendered and did not. -->
    <div
      class="flex w-full max-w-[540px] flex-col items-center gap-5 rounded-card border px-6 py-10 text-center"
      :class="isSoon ? 'border-line-divider bg-surface-subtle' : 'border-line bg-surface shadow-card'"
    >
      <div
        class="flex h-12 w-12 items-center justify-center rounded-card border"
        :class="isSoon
          ? 'border-line-divider bg-surface text-ink-faint'
          : 'border-brand-tintBorder bg-brand-tint text-brand-text'"
      >
        <slot name="icon">
          <!-- A default so a caller that has no icon still gets the shape
          rather than an empty box collapsing the layout. -->
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.4" />
            <path d="M3 8h14" stroke="currentColor" stroke-width="1.4" />
          </svg>
        </slot>
      </div>

      <div class="flex flex-col items-center gap-2">
        <span
          v-if="eyebrow"
          class="rounded-pill px-2 py-px text-[10.5px] font-semibold uppercase tracking-[.06em]"
          :class="isSoon ? 'bg-chip-bg text-ink-muted' : 'bg-brand-tint text-brand-text'"
          data-test="empty-state-eyebrow"
        >{{ eyebrow }}</span>

        <h2 class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ title }}</h2>

        <p v-if="description" class="max-w-[46ch] text-[12.5px] leading-[1.55] text-ink-muted">
          {{ description }}
        </p>
      </div>

      <!-- Only renders when a caller gives it something. An empty action row
      leaves a gap that reads as a button that failed to appear. -->
      <div v-if="$slots.actions" class="flex flex-wrap justify-center gap-2">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
