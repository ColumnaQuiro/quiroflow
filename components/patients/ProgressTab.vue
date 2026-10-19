<script setup lang="ts">
// Progreso: the patient's pain 0-10 visit by visit (visit_pain_scores, the
// practitioner's score over the patient's own when there are both), as a
// curve and a table beside what was adjusted (visit_listings), with where
// they started, where they are and the care plan they are on -- loaded by
// usePatientProgress, which the staff app's record reads too. "Informe de
// revisión" turns the same page into the PDF handed over at the re-exam
// (utils/reportPdf: the figures and the table as text, the curve as an image).
// Under the visit notes permissions, like everything else clinical.
const props = defineProps<{ patientId: string; patient: { first_name: string | null; last_name: string | null; clinic_id: string | null } }>()

const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const toast = useToast()

const { plan, loading, scored, first, latest, change } = usePatientProgress(() => props.patientId)
const busy = ref(false)
const root = ref<HTMLElement | null>(null)
// What the last file held, for the e2e spec (as components/reports/PdfButton).
const lastResult = ref('')
const day = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' })

const patientName = computed(() => `${props.patient.first_name ?? ''} ${props.patient.last_name ?? ''}`.trim())
async function report() {
  if (!root.value || busy.value) return
  busy.value = true
  try {
    const clinic = store.clinics.find((c) => c.id === props.patient.clinic_id) ?? store.clinics.find((c) => c.logo_storage_path)
    const logoUrl = clinic?.logo_storage_path ? supabase.storage.from('clinic-logos').getPublicUrl(clinic.logo_storage_path).data.publicUrl : null
    const title = t(`Progress report · ${patientName.value}`, `Informe de revisión · ${patientName.value}`)
    // utils/reportPdf pulls in pdf-lib and html-to-image, ~245 KB gzipped, so it
    // is fetched when the button is pressed, not with the page.
    const { downloadReportPdf, pdfFileName } = await import('~/utils/reportPdf')
    const result = await downloadReportPdf(root.value, {
      title,
      lines: [
        [store.accountName, clinic?.name].filter(Boolean).join(' · '),
        plan.value ? t(`${plan.value.name}: ${plan.value.done} of ${plan.value.total} visits`, `${plan.value.name}: ${plan.value.done} de ${plan.value.total} visitas`) : t('No care plan', 'Sin plan de tratamiento'),
      ],
      generatedBy: store.teamMember?.full_name ?? '',
      logoUrl,
      fileName: pdfFileName(title, new Date().toISOString().slice(0, 10)),
    })
    lastResult.value = JSON.stringify(result)
  } catch (e) {
    toast.showToast(t('The PDF could not be made: ', 'No se ha podido generar el PDF: ') + (e instanceof Error ? e.message : String(e)), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div ref="root" class="flex flex-col gap-4" data-cy="progress-tab" :data-ready="loading ? undefined : 'true'" :aria-busy="loading">
    <div class="flex flex-wrap items-center gap-3" data-pdf-skip>
      <p v-if="plan" class="text-[13px] text-ink-700" data-cy="progress-plan">
        <span class="font-semibold text-ink-900">{{ plan.name }}</span> · {{ t(`${plan.done} of ${plan.total} visits`, `${plan.done} de ${plan.total} visitas`) }}
      </p>
      <span class="flex-1" />
      <UiBtn :disabled="busy || loading || !scored.length" data-cy="progress-report" :data-pdf-result="lastResult" @click="report">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>
        {{ busy ? t('Preparing…', 'Preparando…') : t('Progress report', 'Informe de revisión') }}
      </UiBtn>
    </div>

    <div v-if="loading" class="space-y-3"><UiSkeleton class="h-20 w-full rounded-card" /><UiSkeleton class="h-56 w-full rounded-card" /></div>

    <div v-else-if="!scored.length" class="rounded-card border border-dashed border-line-control p-8 text-center text-[13.5px] text-ink-muted" data-cy="progress-empty">
      {{ t('No pain scores yet. They are tapped beside the visit note on My Day, or given by the patient when they check in.', 'Aún no hay dolor registrado. Se marca junto a la nota en Mi día, o lo da el paciente al registrar su llegada.') }}
    </div>

    <template v-else>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3" data-pdf-block="kpis">
        <div class="rounded-card border border-line bg-surface p-4 shadow-card" data-pdf-kpi>
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted" data-pdf-label>{{ t('Pain now', 'Dolor ahora') }}</p>
          <p class="mt-1.5 font-mono text-[24px] font-semibold text-ink-900" data-pdf-value data-cy="progress-latest">{{ latest }}<span class="text-[13px] font-normal text-ink-muted">/10</span></p>
          <p class="text-[12px] text-ink-muted" data-pdf-note>{{ day(scored[scored.length - 1]!.startsAt) }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card" data-pdf-kpi>
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted" data-pdf-label>{{ t('When they started', 'Al empezar') }}</p>
          <p class="mt-1.5 font-mono text-[24px] font-semibold text-ink-900" data-pdf-value>{{ first }}<span class="text-[13px] font-normal text-ink-muted">/10</span></p>
          <p class="text-[12px] text-ink-muted" data-pdf-note>{{ day(scored[0]!.startsAt) }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface p-4 shadow-card" data-pdf-kpi>
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted" data-pdf-label>{{ t('Change', 'Cambio') }}</p>
          <p class="mt-1.5 font-mono text-[24px] font-semibold" :class="change === null ? 'text-ink-900' : change < 0 ? 'text-success-text' : change > 0 ? 'text-danger-text' : 'text-ink-900'" data-pdf-value data-cy="progress-change">
            {{ change === null ? '—' : change > 0 ? `+${change}` : change }}
          </p>
          <p class="text-[12px] text-ink-muted" data-pdf-note>{{ t(`${scored.length} visits scored`, `${scored.length} visitas con dolor`) }}</p>
        </div>
      </div>

      <section class="rounded-card border border-line bg-surface p-4 shadow-card" data-pdf-block="image" data-pdf-span="12">
        <h3 class="text-[14px] font-semibold text-ink-900">{{ t('Pain by visit', 'Dolor por visita') }}</h3>
        <PatientsPainChart class="mt-2" :visits="scored" />
      </section>

      <section class="overflow-x-auto rounded-card border border-line bg-surface shadow-card" data-pdf-block="table" :data-pdf-title="t('Visits', 'Visitas')">
        <table class="w-full min-w-[560px]">
          <thead class="border-b border-line bg-surface-subtle">
            <tr>
              <th class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Date', 'Fecha') }}</th>
              <th class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Visit', 'Visita') }}</th>
              <th class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Pain', 'Dolor') }}</th>
              <th class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Adjusted', 'Ajustado') }}</th>
              <th class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ t('Scored by', 'Marcado por') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="r in [...scored].reverse()" :key="r.id" data-cy="progress-row">
              <td class="px-3 py-2 text-[13px] text-ink-700">{{ day(r.startsAt) }}</td>
              <td class="px-3 py-2 text-[13px] text-ink-700">{{ r.type ?? '—' }}</td>
              <td class="px-3 py-2 font-mono text-[13px] font-semibold text-ink-900">{{ r.score }}</td>
              <td class="px-3 py-2 text-[13px] text-ink-700">{{ r.listing || '—' }}</td>
              <td class="px-3 py-2 text-[12.5px] text-ink-muted">{{ r.byPatient ? t('Patient, on arrival', 'Paciente, al llegar') : (r.practitioner ?? t('Practitioner', 'Profesional')) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>

    <PostureSection v-if="!loading" :patient-id="patientId" class="mt-2" />
  </div>
</template>
