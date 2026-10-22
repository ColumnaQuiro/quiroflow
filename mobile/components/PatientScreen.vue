<script setup lang="ts">
// The header every patient tab opens with. The old home screen had one
// "Hi, Raul" and then unlabelled sections, so nothing on screen said what
// you were looking at.
// `back`: for a screen that is not a tab of its own (the full invoice list,
// opened from Plan), where to go back to.
defineProps<{ title: string; lead?: string; back?: string }>()
const t = useT()
</script>

<template>
  <!-- A readable column on an iPad rather than cards stretched across it. -->
  <div class="p-4 md:px-[max(1.5rem,calc((100%_-_44rem)/2))]">
    <header class="mb-4">
      <NuxtLink v-if="back" :to="back" class="-ml-1 mb-1 inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-brand-text" data-cy="patient-screen-back">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
        {{ t('Plan', 'Plan') }}
      </NuxtLink>
      <h1 class="text-[19px] font-[640] tracking-tightTitle text-ink-900">{{ title }}</h1>
      <p v-if="lead" class="mt-1 text-[13px] text-ink-muted">{{ lead }}</p>
    </header>
    <slot />
  </div>
</template>
