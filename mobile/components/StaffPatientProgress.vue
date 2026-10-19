<script setup lang="ts">
// Progress on the staff app's patient record: the web's Progreso tab at
// phone width -- pain now, when they started and the change, the curve, and
// each scored visit with what was adjusted. Read through usePatientProgress,
// as the web reads it. The pain and the listing are tapped on the visit
// screen (/calendar/<id>), beside today's note, or the pain is given by the
// patient when they check in. Only rendered for a role with
// visit_notes_access (the page decides), as on the web.
//
// No "Informe de revisión" here: utils/reportPdf saves through a download
// link, which WKWebView ignores. The PDF is made from the web record.
const props = defineProps<{ patientId: string; timeZone: string }>()

const t = useT()
const { loading, scored, first, latest, change } = usePatientProgress(() => props.patientId)

const showAll = ref(false)
const PREVIEW_COUNT = 4
// Newest first, as the visit list beside it.
const visits = computed(() => [...scored.value].reverse())
const shown = computed(() => (showAll.value ? visits.value : visits.value.slice(0, PREVIEW_COUNT)))

const locale = computed(() => t('en-GB', 'es-ES'))
function dayLabel(iso: string) {
  const d = new Date(iso)
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear()
  return d.toLocaleDateString(locale.value, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: props.timeZone })
}
const changeCls = computed(() => (change.value === null || change.value === 0 ? 'text-ink-900' : change.value < 0 ? 'text-success-text' : 'text-danger-text'))
</script>

<template>
  <section class="rounded-card border border-line bg-surface shadow-card px-3.5 py-3" data-cy="patient-progress" :aria-busy="loading">
    <div class="flex items-center justify-between">
      <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Progress', 'Progreso') }}</h2>
      <button v-if="visits.length > PREVIEW_COUNT" type="button" class="text-[12.5px] font-medium text-brand-text" @click="showAll = !showAll">
        <template v-if="showAll">{{ t('Fewer', 'Menos') }}</template><template v-else>{{ t('All', 'Todas') }} <AppChevron :size="12" /></template>
      </button>
    </div>

    <div v-if="loading" class="mt-2.5 space-y-2">
      <UiSkeleton class="h-12 w-full rounded-ctlSm" />
      <UiSkeleton class="h-28 w-full rounded-ctlSm" />
    </div>

    <p v-else-if="!scored.length" class="mt-1.5 text-[13px] leading-snug text-ink-faint" data-cy="patient-progress-empty">
      {{ t('No pain scores yet. Tap them on the visit, beside today\'s note, or the patient gives one when they check in.', 'Aún no hay dolor registrado. Se marca en la visita, junto a la nota de hoy, o lo da el paciente al registrar su llegada.') }}
    </p>

    <template v-else>
      <div class="mt-2 grid grid-cols-3 gap-2">
        <div class="rounded-[10px] bg-surface-page px-2.5 py-2">
          <p class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-ink-muted">{{ t('Pain now', 'Dolor ahora') }}</p>
          <p class="mt-0.5 font-mono text-[19px] font-semibold text-ink-900" data-cy="patient-progress-latest">{{ latest }}<span class="text-[12px] font-normal text-ink-muted">/10</span></p>
        </div>
        <div class="rounded-[10px] bg-surface-page px-2.5 py-2">
          <p class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-ink-muted">{{ t('At start', 'Al empezar') }}</p>
          <p class="mt-0.5 font-mono text-[19px] font-semibold text-ink-900">{{ first }}<span class="text-[12px] font-normal text-ink-muted">/10</span></p>
        </div>
        <div class="rounded-[10px] bg-surface-page px-2.5 py-2">
          <p class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-ink-muted">{{ t('Change', 'Cambio') }}</p>
          <p class="mt-0.5 font-mono text-[19px] font-semibold" :class="changeCls" data-cy="patient-progress-change">{{ change === null ? '—' : change > 0 ? `+${change}` : change }}</p>
        </div>
      </div>

      <PatientsPainChart class="mt-2.5 md:mx-auto md:max-w-[560px]" :visits="scored" :width="360" :height="170" :max-labels="4" />

      <ul class="mt-2 space-y-2" data-cy="patient-progress-visits">
        <li v-for="r in shown" :key="r.id">
          <NuxtLink :to="`/calendar/${r.id}`" class="block" data-cy="patient-progress-row">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-[13.5px] font-semibold text-ink-900">{{ dayLabel(r.startsAt) }}<template v-if="r.type"> · {{ r.type }}</template></span>
              <span class="shrink-0 font-mono text-[13.5px] font-semibold text-ink-900">{{ r.score }}<span class="text-[11.5px] font-normal text-ink-muted">/10</span></span>
            </div>
            <p class="mt-0.5 truncate text-[12.5px] text-ink-muted2">
              {{ r.listing || t('Nothing listed', 'Sin ajuste anotado') }} · {{ r.byPatient ? t('patient, on arrival', 'paciente, al llegar') : (r.practitioner ?? t('practitioner', 'profesional')) }}
            </p>
          </NuxtLink>
        </li>
      </ul>
    </template>
  </section>
</template>
