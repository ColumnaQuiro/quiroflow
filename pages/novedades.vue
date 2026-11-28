<script setup lang="ts">
import { NEWS_AREAS, newsWeekStart, type NewsArea, type NewsEntry, type NewsKind } from '../utils/productNews'

// Novedades: every change worth telling a clinic about, a week at a time,
// from utils/productNews.ts. Owners only (utils/routePermissions.ts, and the
// top bar shows the button to no one else): what changes in the product is
// the owner's to read and pass on to the team.
const t = useT()
const { entries, unreadIds, markSeen } = useProductNews()

type Filter = 'all' | NewsKind
const filter = ref<Filter>('all')
const area = ref<NewsArea | null>(null)
const openId = ref<string | null>(null)
const openFixes = ref<Set<string>>(new Set())

// Read on arrival, so the top bar's count clears as soon as the page shows.
// An entry picked in the top bar's panel arrives as #id: open it and bring it
// into view by hand, since the page scrolls inside its own container and the
// router only ever scrolls the window.
const route = useRoute()
async function focusHash() {
  const id = route.hash.slice(1)
  const entry = id ? entries.find((e) => e.id === id) : undefined
  if (!entry) return
  filter.value = 'all'
  area.value = null
  if (entry.kind === 'fix') openFixes.value = new Set([...openFixes.value, newsWeekStart(entry.date)])
  else if (entry.steps) openId.value = entry.id
  await nextTick()
  document.getElementById(`news-${entry.id}`)?.scrollIntoView({ block: 'start' })
}
onMounted(() => {
  markSeen()
  focusHash()
})
watch(() => route.hash, focusHash)

const FILTERS: { id: Filter; label: () => string }[] = [
  { id: 'all', label: () => t('All', 'Todo') },
  { id: 'new', label: () => t('New', 'Nuevo') },
  { id: 'improvement', label: () => t('Improvements', 'Mejoras') },
  { id: 'fix', label: () => t('Fixes', 'Correcciones') },
]

const inArea = computed(() => entries.filter((e) => !area.value || e.area === area.value))
const counts = computed(() => {
  const c: Record<Filter, number> = { all: 0, new: 0, improvement: 0, fix: 0 }
  for (const e of inArea.value) {
    c[e.kind]++
    c.all++
  }
  return c
})

const areaCounts = computed(() => {
  const c = new Map<NewsArea, number>()
  for (const e of entries) c.set(e.area, (c.get(e.area) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1])
})

const locale = computed(() => t('en-GB', 'es-ES'))
function dayLabel(date: string) {
  return new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

const thisWeek = newsWeekStart(new Date().toISOString().slice(0, 10))
const lastWeek = (() => {
  const d = new Date(`${thisWeek}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 7)
  return d.toISOString().slice(0, 10)
})()

function weekLabel(start: string) {
  if (start === thisWeek) return t('This week', 'Esta semana')
  if (start === lastWeek) return t('Last week', 'Semana anterior')
  return t(`Week of ${dayLabel(start)}`, `Semana del ${dayLabel(start)}`)
}
function weekRange(start: string) {
  const end = new Date(`${start}T12:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 6)
  return `${dayLabel(start)} – ${dayLabel(end.toISOString().slice(0, 10))}`
}

interface Week {
  start: string
  featured: NewsEntry[]
  rows: NewsEntry[]
  fixes: NewsEntry[]
  total: number
}

const weeks = computed<Week[]>(() => {
  const byWeek = new Map<string, Week>()
  for (const e of inArea.value) {
    const start = newsWeekStart(e.date)
    let w = byWeek.get(start)
    if (!w) byWeek.set(start, (w = { start, featured: [], rows: [], fixes: [], total: 0 }))
    w.total++
    if (filter.value !== 'all' && filter.value !== e.kind) continue
    if (e.kind === 'fix') w.fixes.push(e)
    else if (e.featured && filter.value === 'all') w.featured.push(e)
    else w.rows.push(e)
  }
  return [...byWeek.values()].filter((w) => w.featured.length || w.rows.length || w.fixes.length)
})

function fixesOpen(w: Week) {
  return filter.value === 'fix' || openFixes.value.has(w.start)
}
function toggleFixes(w: Week) {
  const next = new Set(openFixes.value)
  if (next.has(w.start)) next.delete(w.start)
  else next.add(w.start)
  openFixes.value = next
}

const KIND_TONE: Record<NewsKind, 'brand' | 'success' | 'neutral'> = { new: 'brand', improvement: 'success', fix: 'neutral' }
function kindLabel(kind: NewsKind) {
  return kind === 'new' ? t('New', 'Nuevo') : kind === 'improvement' ? t('Improvement', 'Mejora') : t('Fix', 'Corrección')
}
</script>

<template>
  <div class="flex h-full flex-col" data-cy="news-page">
    <PageHeader :title="t('What’s new', 'Novedades')" :meta="t('What changes in QuiroFlow, week by week', 'Lo que cambia en QuiroFlow, semana a semana')">
      <div role="group" :aria-label="t('Filter by type', 'Filtrar por tipo')" class="flex flex-wrap gap-1.5">
        <button
          v-for="f in FILTERS"
          :key="f.id"
          type="button"
          :data-cy="`news-filter-${f.id}`"
          :aria-pressed="filter === f.id"
          class="flex h-8 items-center gap-1.5 rounded-ctl border px-3 text-[13px] touch:h-11"
          :class="filter === f.id ? 'border-brand bg-brand font-semibold text-brand-on' : 'border-line-control bg-surface font-medium text-ink-500 hover:border-line-controlHover'"
          @click="filter = f.id"
        >
          {{ f.label() }}
          <span class="font-mono text-[11px]" :class="filter === f.id ? '' : 'text-ink-muted'">{{ counts[f.id] }}</span>
        </button>
      </div>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-24 pt-5 sm:px-6 lg:pb-10">
      <div class="mx-auto flex max-w-[1120px] flex-wrap items-start gap-6">
        <div class="flex min-w-0 flex-[999_1_520px] flex-col gap-7">
          <p v-if="!weeks.length" class="rounded-card border border-line bg-surface p-6 text-center text-[13px] text-ink-muted" data-cy="news-empty">
            {{ t('Nothing of this type here yet.', 'Todavía no hay nada de este tipo.') }}
          </p>

          <section v-for="w in weeks" :key="w.start" class="flex flex-col gap-3" data-cy="news-week">
            <div class="flex items-center gap-2.5">
              <h2 class="text-[11px] font-[640] uppercase tracking-[0.07em] text-ink-500">{{ weekLabel(w.start) }}</h2>
              <span class="font-mono text-[11px] text-ink-muted">{{ weekRange(w.start) }}</span>
              <span class="h-px flex-1 bg-line" />
              <span class="text-[12px] text-ink-muted">{{ t(`${w.total} changes`, `${w.total} cambios`) }}</span>
            </div>

            <div v-if="w.featured.length" class="grid gap-3 sm:grid-cols-2">
              <article v-for="e in w.featured" :key="e.id" class="flex scroll-mt-4 flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-card" :id="`news-${e.id}`" :data-cy="`news-entry-${e.id}`">
                <div class="flex items-center gap-2">
                  <span v-if="unreadIds.has(e.id)" class="h-1.5 w-1.5 rounded-full bg-brand" :title="t('Unread', 'Sin leer')" />
                  <UiPill :tone="KIND_TONE[e.kind]" dot>{{ kindLabel(e.kind) }}</UiPill>
                  <span class="text-[12px] text-ink-muted">{{ t(...NEWS_AREAS[e.area]) }}</span>
                  <span class="ml-auto font-mono text-[11px] text-ink-muted">{{ dayLabel(e.date) }}</span>
                </div>
                <h3 class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t(...e.title) }}</h3>
                <p v-if="e.body" class="text-[12.5px] leading-[1.55] text-ink-muted2">{{ t(...e.body) }}</p>
                <UiPill v-if="e.tag" :tone="e.tag.tone" class="self-start">{{ t(...e.tag.label) }}</UiPill>
                <NewsHowTo v-if="e.where" :entry="e" class="mt-auto pt-1" />
              </article>
            </div>

            <div v-if="w.rows.length || w.fixes.length" class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
              <div v-for="e in w.rows" :key="e.id" class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line-divider px-4 py-3 sm:grid-cols-[96px_minmax(0,1fr)_120px_52px]" :id="`news-${e.id}`" :data-cy="`news-entry-${e.id}`">
                <div class="self-start pt-px">
                  <UiPill :tone="KIND_TONE[e.kind]" dot>{{ kindLabel(e.kind) }}</UiPill>
                </div>
                <div class="min-w-0">
                  <button
                    type="button"
                    class="block w-full text-left disabled:cursor-default"
                    :aria-expanded="e.steps ? openId === e.id : undefined"
                    :disabled="!e.steps"
                    :data-cy="`news-toggle-${e.id}`"
                    @click="openId = openId === e.id ? null : e.id"
                  >
                    <span class="flex items-center gap-1.5 text-[13px] font-medium text-ink-900">
                      <span v-if="unreadIds.has(e.id)" class="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" :title="t('Unread', 'Sin leer')" />
                      {{ t(...e.title) }}
                    </span>
                    <span v-if="e.body" class="block text-[12.5px] text-ink-muted2">{{ t(...e.body) }}</span>
                  </button>
                  <p v-if="e.where" class="mt-1 flex items-center gap-1.5 text-[12px] text-ink-500">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-ink-muted" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0113 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10.5" r="2" /></svg>
                    <span class="text-ink-muted">{{ t('Where:', 'Dónde:') }}</span>
                    <span class="font-medium">{{ t(...e.where.label) }}</span>
                  </p>
                  <UiPill v-if="e.tag" :tone="e.tag.tone" class="mt-1.5">{{ t(...e.tag.label) }}</UiPill>
                  <NewsHowTo v-if="e.steps && openId === e.id" :entry="e" boxed class="mt-2" />
                </div>
                <span class="hidden pt-px text-[12px] text-ink-muted sm:block">{{ t(...NEWS_AREAS[e.area]) }}</span>
                <span class="hidden pt-0.5 text-right font-mono text-[11px] text-ink-muted sm:block">{{ dayLabel(e.date) }}</span>
              </div>

              <template v-if="w.fixes.length">
                <button
                  type="button"
                  class="flex min-h-11 w-full items-center gap-3 bg-surface-subtle px-4 py-2 text-left text-[13px] text-ink-500"
                  :aria-expanded="fixesOpen(w)"
                  data-cy="news-fixes-toggle"
                  @click="toggleFixes(w)"
                >
                  <UiPill>{{ t('Fix', 'Corrección') }}</UiPill>
                  <span class="flex-1">{{ t(`${w.fixes.length} fixes`, `${w.fixes.length} correcciones`) }}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-ink-muted" :class="fixesOpen(w) && 'rotate-180'" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
                </button>
                <template v-if="fixesOpen(w)">
                  <div v-for="e in w.fixes" :key="e.id" class="grid grid-cols-[minmax(0,1fr)] gap-x-3 border-t border-line-divider bg-surface-subtle px-4 py-2 sm:grid-cols-[96px_minmax(0,1fr)_120px_52px]" :id="`news-${e.id}`" :data-cy="`news-entry-${e.id}`">
                    <span class="hidden sm:block" />
                    <span class="text-[12.5px] text-ink-600">{{ t(...e.title) }}</span>
                    <span class="hidden text-[12px] text-ink-muted sm:block">{{ t(...NEWS_AREAS[e.area]) }}</span>
                    <span class="hidden text-right font-mono text-[11px] text-ink-muted sm:block">{{ dayLabel(e.date) }}</span>
                  </div>
                </template>
              </template>
            </div>
          </section>
        </div>

        <aside class="flex w-full flex-col gap-3 lg:max-w-[260px] lg:flex-[1_1_232px]">
          <div class="rounded-card border border-line bg-surface px-4 py-3.5 shadow-card">
            <h2 class="mb-1.5 text-[11px] font-[640] uppercase tracking-[0.07em] text-ink-faint">{{ t('By area', 'Por área') }}</h2>
            <button
              v-for="[key, n] in areaCounts"
              :key="key"
              type="button"
              :aria-pressed="area === key"
              :data-cy="`news-area-${key}`"
              class="flex h-8 w-full items-center justify-between border-t border-line-divider px-1 text-[13px] touch:h-11"
              :class="area === key ? 'font-semibold text-brand-text' : 'text-ink-600 hover:text-ink-900'"
              @click="area = area === key ? null : key"
            >
              <span>{{ t(...NEWS_AREAS[key]) }}</span>
              <span class="font-mono text-[11px] text-ink-muted">{{ n }}</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>
