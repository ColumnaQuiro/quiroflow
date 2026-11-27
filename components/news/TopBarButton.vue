<script setup lang="ts">
import { NEWS_AREAS, type NewsKind } from '../../utils/productNews'

// Novedades in the top bar, where the help assistant used to be: the latest
// entries in a panel, a count of the ones this person has not seen, and the
// way into /novedades. Opening the panel counts as seeing them.
const t = useT()
const { entries, unread, unreadIds, markSeen } = useProductNews()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
useDismissOnOutside(root, open)

// The count is worked out from a login's metadata and today's date, neither of
// which the server render can be trusted to agree on with the browser. The
// button also waits for hydration: server-rendered, a click before it would
// be lost, and the panel never open (as TeamAlertButton found first).
const hydrated = ref(false)
onMounted(() => (hydrated.value = true))
const count = computed(() => (hydrated.value ? unread.value.length : 0))

const latest = computed(() => entries.filter((e) => e.kind !== 'fix').slice(0, 5))
const route = useRoute()
watch(() => route.path, () => (open.value = false))

// Marked when the panel is closed rather than opened, so the dots are still
// there to read while it is open.
watch(open, (isOpen, wasOpen) => {
  if (wasOpen && !isOpen) markSeen()
})

const locale = computed(() => t('en-GB', 'es-ES'))
function dayLabel(date: string) {
  return new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}
const KIND_TONE: Record<NewsKind, 'brand' | 'success' | 'neutral'> = { new: 'brand', improvement: 'success', fix: 'neutral' }
function kindLabel(kind: NewsKind) {
  return kind === 'new' ? t('New', 'Nuevo') : kind === 'improvement' ? t('Improvement', 'Mejora') : t('Fix', 'Corrección')
}
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      data-cy="news-open"
      :disabled="!hydrated"
      :aria-expanded="open"
      :aria-label="count ? t(`What’s new, ${count} unread`, `Novedades, ${count} sin leer`) : t('What’s new', 'Novedades')"
      class="flex h-7 items-center gap-1.5 rounded-ctl border px-2 text-[12.5px] font-semibold touch:h-11"
      :class="open || route.path === '/novedades' ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:bg-surface-subtle'"
      @click="open = !open"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4h3l8 4V6l-8 4H4zM18.5 9.5a4 4 0 010 5" /></svg>
      <span class="hidden sm:inline">{{ t('What’s new', 'Novedades') }}</span>
      <span v-if="count" data-cy="news-unread-count" class="flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-brand px-1 font-mono text-[11px] font-semibold text-brand-on">{{ count }}</span>
    </button>

    <section
      v-if="open"
      data-cy="news-panel"
      :aria-label="t('What’s new', 'Novedades')"
      class="absolute right-0 top-[calc(100%+6px)] z-40 w-[min(396px,calc(100vw-24px))] overflow-hidden rounded-card border border-line bg-surface shadow-popover"
    >
      <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
        <h2 class="text-[14.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('What’s new', 'Novedades') }}</h2>
        <span v-if="count" class="text-[12px] text-ink-muted">{{ t(`${count} unread`, `${count} sin leer`) }}</span>
      </div>
      <NuxtLink
        v-for="e in latest"
        :key="e.id"
        :to="`/novedades#${e.id}`"
        class="flex gap-3 border-b border-line-divider px-4 py-2.5 hover:bg-surface-subtle"
        @click="open = false"
      >
        <span class="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" :class="unreadIds.has(e.id) ? 'bg-brand' : ''" />
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="flex items-center gap-2">
            <UiPill :tone="KIND_TONE[e.kind]">{{ kindLabel(e.kind) }}</UiPill>
            <span class="text-[12px] text-ink-muted">{{ t(...NEWS_AREAS[e.area]) }}</span>
            <span class="ml-auto font-mono text-[11px] text-ink-muted">{{ dayLabel(e.date) }}</span>
          </span>
          <span class="text-[13px] text-ink-900" :class="unreadIds.has(e.id) && 'font-medium'">{{ t(...e.title) }}</span>
        </span>
      </NuxtLink>
      <NuxtLink to="/novedades" data-cy="news-see-all" class="flex h-11 items-center justify-center gap-1.5 text-[13px] font-semibold text-brand-text hover:bg-surface-subtle" @click="open = false">
        {{ t('See everything new', 'Ver todas las novedades') }}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </NuxtLink>
    </section>
  </div>
</template>
