<script setup lang="ts">
// The frame of every report on the app (pages/reports/*): the bar with Back,
// a row of filters under it, and the body scrolling beneath. It also answers
// "may this person open it?" with the web's own rule for the same path
// (useReportAccess), so a report reached from a link or a stale screen says
// so instead of showing figures the role does not include.
//
// `path` is the WEB path the report lives at, which is also this app's path
// for it, except where noted by the page (Third parties).
const props = defineProps<{ title: string; path: string; description?: string }>()
const t = useT()
const router = useRouter()
const { loading, context, canOpen } = useReportAccess()
const allowed = computed(() => canOpen(props.path))

function back() {
  // Opened straight onto a report (a widget, a cold start): Back goes to
  // the list rather than nowhere.
  if (window.history.state?.back) router.back()
  else router.replace('/reports')
}
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col bg-surface-page">
    <AppPageHeader :title="title" back @back="back">
      <slot name="actions" />
    </AppPageHeader>

    <AppSkeletonList v-if="loading" :rows="5" class="min-h-0 flex-1" />
    <p v-else-if="!context || !allowed" class="m-4 rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted" data-cy="report-no-access">
      {{ t("Your role doesn't include this report.", 'Tu rol no incluye este informe.') }}
    </p>
    <template v-else>
      <!-- Filters scroll sideways rather than wrap: a phone fits two or three. -->
      <div v-if="$slots.filters" class="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-surface px-3 py-2 md:px-5 [&::-webkit-scrollbar]:hidden" data-cy="report-filters">
        <slot name="filters" />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-[max(1.5rem,calc((100%_-_52rem)/2))]" style="padding-bottom: max(env(safe-area-inset-bottom), 1rem)" data-cy="report-body">
        <p v-if="description" class="mb-3 px-1 text-[12.5px] leading-snug text-ink-muted">{{ description }}</p>
        <div class="flex flex-col gap-3">
          <slot />
        </div>
      </div>
    </template>
  </div>
</template>
