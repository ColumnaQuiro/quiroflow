<script setup lang="ts">
import type { TimelineCategory, TimelineEvent } from '../../utils/patientTimeline'

// The record's activity timeline (Overview): everything that happened to
// this patient, newest first, filterable by kind. See utils/patientTimeline.ts.
const props = defineProps<{ patientId: string; timeZone?: string | null }>()

const t = useT()
const { events, loading, load } = usePatientTimeline(() => props.patientId, () => props.timeZone)
defineExpose({ reload: (opts: { silent?: boolean } = {}) => load(opts) })

// Messages and calls are one filter, "Contact": a minor's or a do-not-contact
// patient's record offers nothing that reads as a way to message them
// (patient-record-actions.cy.ts), and a chip called "Messages" did.
type FilterKey = 'all' | 'visit' | 'contact' | 'care' | 'document' | 'billing'
const FILTERS = computed<{ key: FilterKey; label: string }[]>(() => [
  { key: 'all', label: t('All', 'Todo') },
  { key: 'visit', label: t('Visits', 'Visitas') },
  { key: 'contact', label: t('Contact', 'Contacto') },
  { key: 'care', label: t('Plan & exercises', 'Plan y ejercicios') },
  { key: 'document', label: t('Documents', 'Documentos') },
  { key: 'billing', label: t('Billing', 'Facturación') },
])
const filter = ref<FilterKey>('all')
const GROUPS: Record<Exclude<FilterKey, 'all'>, TimelineCategory[]> = {
  visit: ['visit'],
  contact: ['communication', 'recall'],
  care: ['plan', 'exercise'],
  document: ['document'],
  billing: ['billing'],
}
const shown = ref(8)
watch(filter, () => (shown.value = 8))
const filtered = computed(() =>
  events.value.filter((e) => filter.value === 'all' || GROUPS[filter.value].includes(e.category)),
)

const CATEGORY: Record<TimelineCategory, { label: () => string; icon: string; tone: string }> = {
  visit: { label: () => t('Visit', 'Visita'), icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', tone: 'bg-brand-tint text-brand-text' },
  communication: { label: () => t('Message', 'Mensaje'), icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.83L3 20l1.3-3.9A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z', tone: 'bg-success-bg text-success-text' },
  recall: { label: () => t('Recall', 'Recuperación'), icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.49a1 1 0 01-.5 1.21l-2.26 1.13a11.04 11.04 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z', tone: 'bg-warning-bg text-warning-text' },
  plan: { label: () => t('Care plan', 'Plan'), icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', tone: 'bg-chip-bg text-ink-700' },
  exercise: { label: () => t('Exercises', 'Ejercicios'), icon: 'M13 10V3L4 14h7v7l9-11h-7z', tone: 'bg-chip-bg text-ink-700' },
  document: { label: () => t('Document', 'Documento'), icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', tone: 'bg-chip-bg text-ink-700' },
  billing: { label: () => t('Billing', 'Facturación'), icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', tone: 'bg-chip-bg text-ink-700' },
}
const TONE_TEXT: Record<string, string> = { success: 'text-success-text', warning: 'text-warning-text', danger: 'text-danger-text' }

function actorLabel(e: TimelineEvent) {
  if (e.actor.kind === 'staff') return e.actor.name
  if (e.actor.kind === 'patient') return t('Patient', 'Paciente')
  return t('System', 'Sistema')
}
function when(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return new Date(iso).toLocaleTimeString(t('en-GB', 'es-ES'), { hour: '2-digit', minute: '2-digit', timeZone: props.timeZone ?? undefined })
  if (days === 1) return t('Yesterday', 'Ayer')
  if (days < 7) return t(`${days}d ago`, `hace ${days} d`)
  return new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined, timeZone: props.timeZone ?? undefined })
}
const full = (iso: string) => new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { dateStyle: 'full', timeStyle: 'short', timeZone: props.timeZone ?? undefined })
</script>

<template>
  <section aria-labelledby="ov-activity" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-timeline">
    <h2 id="ov-activity" class="text-[13.5px] font-semibold text-ink-700">{{ t('Activity', 'Actividad') }}</h2>
    <div class="mt-2.5 flex flex-wrap gap-1.5" role="tablist" :aria-label="t('Show', 'Mostrar')">
      <button
        v-for="f in FILTERS"
        :key="f.key"
        type="button"
        role="tab"
        :aria-selected="filter === f.key"
        class="h-7 rounded-pill border px-2.5 text-[12px] font-medium"
        :class="filter === f.key ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-muted hover:bg-surface-subtle'"
        :data-cy="`timeline-filter-${f.key}`"
        @click="filter = f.key"
      >
        {{ f.label }}
      </button>
    </div>

    <div v-if="loading" class="mt-4 space-y-4">
      <div v-for="i in 4" :key="i" class="flex gap-3">
        <UiSkeleton class="h-7 w-7 shrink-0 rounded-full" />
        <div class="flex-1 space-y-1.5"><UiSkeleton class="h-3 w-24 rounded-ctlSm" /><UiSkeleton class="h-3.5 w-3/4 rounded-ctlSm" /></div>
      </div>
    </div>
    <p v-else-if="!filtered.length" class="mt-4 text-[12.5px] text-ink-faint">{{ t('Nothing here yet.', 'Aún no hay nada.') }}</p>
    <ol v-else class="relative mt-4">
      <li v-for="(e, i) in filtered.slice(0, shown)" :key="e.key" class="relative flex gap-3 pb-4 last:pb-0" data-cy="timeline-event" :data-category="e.category">
        <span v-if="i < Math.min(shown, filtered.length) - 1" aria-hidden="true" class="absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px bg-line" />
        <span class="z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full" :class="CATEGORY[e.category].tone" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path :d="CATEGORY[e.category].icon" /></svg>
        </span>
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span class="rounded-pill px-1.5 py-px font-semibold" :class="CATEGORY[e.category].tone">{{ CATEGORY[e.category].label() }}</span>
            <span v-if="e.channel" class="rounded-pill border border-line px-1.5 py-px text-ink-muted">{{ e.channel }}</span>
            <time class="ml-auto shrink-0 text-ink-faint" :datetime="e.at" :title="full(e.at)">{{ when(e.at) }}</time>
          </p>
          <p class="mt-1 line-clamp-3 text-[13px] leading-snug" :class="e.tone ? TONE_TEXT[e.tone] : 'text-ink-900'" data-cy="timeline-text">{{ e.text }}</p>
          <p class="mt-0.5 text-[11.5px] text-ink-faint" data-cy="timeline-actor">{{ actorLabel(e) }}</p>
        </div>
      </li>
    </ol>
    <button v-if="!loading && filtered.length > shown" type="button" class="mt-3 text-[12.5px] font-medium text-brand-text hover:underline" data-cy="timeline-more" @click="shown += 15">
      {{ t(`Show more (${filtered.length - shown})`, `Ver más (${filtered.length - shown})`) }}
    </button>
  </section>
</template>
