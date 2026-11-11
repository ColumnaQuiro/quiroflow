<script setup lang="ts">
// The header every patient tab opens with. The old home screen had one
// "Hi, Raul" and then unlabelled sections, so nothing on screen said what
// you were looking at.
//
// `back`: for a screen that is not a tab of its own -- the full invoice list
// opened from Plan, an exercise or a habit opened from Cuidarme -- the screen
// it belongs to. Without it those screens were a dead end on an iPhone: no
// back gesture in the app's web view and no tab lit up, so a patient who
// tapped an exercise on Cuidarme had to close the app to get out of it.
// It always lands on `back`, so `backLabel` (Plan by default, the first user
// of this) never names somewhere else: by going back through the history when
// that is what is behind this screen, so the history does not grow a loop
// that Android's back button would walk through again, and by replacing this
// screen with it otherwise -- opened from Home or a notification.
const props = defineProps<{ title: string; lead?: string; back?: string; backLabel?: string }>()
const t = useT()
const router = useRouter()

function goBack() {
  if (!props.back) return
  // Vue Router keeps the previous in-app path in history.state.back.
  if (import.meta.client && window.history.state?.back === props.back) router.back()
  else navigateTo(props.back, { replace: true })
}
</script>

<template>
  <!-- A readable column on an iPad rather than cards stretched across it. -->
  <div class="p-4 md:px-[max(1.5rem,calc((100%_-_44rem)/2))]">
    <header class="mb-4">
      <!-- A button, not a NuxtLink: RouterLink navigates to `to` in its own
           click handler, before a listener added here could stop it. -->
      <button v-if="back" type="button" class="-ml-1 mb-1 inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-brand-text" data-cy="patient-screen-back" @click="goBack">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>
        {{ backLabel ?? t('Plan', 'Plan') }}
      </button>
      <h1 class="text-[19px] font-[640] tracking-tightTitle text-ink-900">{{ title }}</h1>
      <p v-if="lead" class="mt-1 text-[13px] text-ink-muted">{{ lead }}</p>
    </header>
    <slot />
  </div>
</template>
