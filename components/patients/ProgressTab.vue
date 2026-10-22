<script setup lang="ts">
import { listingSummary, sideLettersFor, type Listings } from '../../utils/spinalListings'

// Progreso: the patient's pain 0-10 visit by visit (visit_pain_scores, the
// practitioner's score over the patient's own when there are both), as a
// curve and a table beside what was adjusted (visit_listings), with where
// they started, where they are and the care plan they are on. "Informe de
// revisión" turns the same page into the PDF handed over at the re-exam
// (utils/reportPdf: the figures and the table as text, the curve as an image).
// Under the visit notes permissions, like everything else clinical.
//
// Also the staff app's Progreso tab (mobile/pages/patients/[id].vue), which
// passes `can`: the app has no web account store -- useAccountStore() is not
// even imported there -- so it is read only on the web, and the PDF report,
// which needs it, is the web's alone. Imports are relative for the same reason
// (in mobile/, `~` is mobile/).
const props = defineProps<{ patientId: string; patient: { first_name: string | null; last_name: string | null; clinic_id: string | null }; can?: (permission: string) => boolean }>()

const t = useT()
const supabase = useSupabaseClient()
const store = props.can ? null : useAccountStore()
const toast = useToast()

interface Row { id: string; startsAt: string; type: string | null; practitioner: string | null; score: number | null; byPatient: boolean; listing: string }
const rows = ref<Row[]>([])
const plan = ref<{ name: string; total: number; done: number } | null>(null)
const loading = ref(true)
const busy = ref(false)
const root = ref<HTMLElement | null>(null)
// What the last file held, for the e2e spec (as components/reports/PdfButton).
const lastResult = ref('')

async function load() {
  loading.value = true
  const { data: appts } = await supabase
    .from('appointments')
    .select('id, starts_at, appointment_types(name), team_members(full_name)')
    .eq('patient_id', props.patientId)
    .is('deleted_at', null)
    .neq('status', 'cancelled')
    .order('starts_at')
  const list = (appts as unknown as { id: string; starts_at: string; appointment_types: { name: string } | null; team_members: { full_name: string } | null }[] | null) ?? []
  const pain = new Map<string, { practitioner_score: number | null; patient_score: number | null }>()
  const listed = new Map<string, Listings>()
  const ids = list.map((a) => a.id)
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const [{ data: p }, { data: l }] = await Promise.all([
      supabase.from('visit_pain_scores').select('appointment_id, practitioner_score, patient_score').in('appointment_id', chunk),
      supabase.from('visit_listings').select('appointment_id, listings').in('appointment_id', chunk),
    ])
    for (const r of (p as { appointment_id: string; practitioner_score: number | null; patient_score: number | null }[] | null) ?? []) pain.set(r.appointment_id, r)
    for (const r of (l as { appointment_id: string; listings: Listings }[] | null) ?? []) listed.set(r.appointment_id, r.listings)
  }
  const letters = sideLettersFor(t)
  rows.value = list.map((a) => {
    const s = pain.get(a.id)
    const score = s?.practitioner_score ?? s?.patient_score ?? null
    return { id: a.id, startsAt: a.starts_at, type: a.appointment_types?.name ?? null, practitioner: a.team_members?.full_name ?? null, score, byPatient: s?.practitioner_score == null && s?.patient_score != null, listing: listingSummary(listed.get(a.id), (x) => x, letters) }
  })

  const { data: cp } = await supabase.from('care_plans').select('name, total_visits, started_at').eq('patient_id', props.patientId).order('started_at', { ascending: false }).limit(1).maybeSingle()
  const c = cp as { name: string; total_visits: number; started_at: string } | null
  const now = new Date().toISOString()
  plan.value = c ? { name: c.name, total: c.total_visits, done: list.filter((a) => a.starts_at >= c.started_at && a.starts_at <= now).length } : null
  loading.value = false
}
watch(() => props.patientId, load, { immediate: true })

const scored = computed(() => rows.value.filter((r) => r.score !== null))
const first = computed(() => scored.value[0]?.score ?? null)
const latest = computed(() => scored.value[scored.value.length - 1]?.score ?? null)
const change = computed(() => (first.value !== null && latest.value !== null && scored.value.length > 1 ? latest.value - first.value : null))
const day = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' })

// The curve: one point per scored visit, 0 at the bottom and 10 at the top.
// Drawn half as wide on a phone (the staff app), so its 11px labels are
// still 11px there rather than shrunk to a third of that.
const compact = !!props.can
const W = compact ? 360 : 720
const H = compact ? 200 : 220
const PAD = { l: 34, r: 16, t: 14, b: 30 }
const points = computed(() => {
  const n = scored.value.length
  const x = (i: number) => PAD.l + (n <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1))
  const y = (v: number) => PAD.t + ((10 - v) * (H - PAD.t - PAD.b)) / 10
  return scored.value.map((r, i) => ({ x: x(i), y: y(r.score!), r }))
})
const line = computed(() => points.value.map((p) => `${p.x},${p.y}`).join(' '))
const gridY = [0, 2, 4, 6, 8, 10].map((v) => ({ v, y: PAD.t + ((10 - v) * (H - PAD.t - PAD.b)) / 10 }))
// Labels under the first, last and every few points between, so they never collide.
const labelEvery = computed(() => Math.max(1, Math.ceil(points.value.length / (compact ? 4 : 8))))

const patientName = computed(() => `${props.patient.first_name ?? ''} ${props.patient.last_name ?? ''}`.trim())
async function report() {
  if (!root.value || busy.value || !store) return
  busy.value = true
  try {
    const clinic = store.clinics.find((c) => c.id === props.patient.clinic_id) ?? store.clinics.find((c) => c.logo_storage_path)
    const logoUrl = clinic?.logo_storage_path ? supabase.storage.from('clinic-logos').getPublicUrl(clinic.logo_storage_path).data.publicUrl : null
    const title = t(`Progress report · ${patientName.value}`, `Informe de revisión · ${patientName.value}`)
    // utils/reportPdf pulls in pdf-lib and html-to-image, ~245 KB gzipped, so it
    // is fetched when the button is pressed, not with the page.
    const { downloadReportPdf, pdfFileName } = await import('../../utils/reportPdf')
    const result = await downloadReportPdf(root.value, {
      title,
      lines: [
        [store.accountName, clinic?.name].filter(Boolean).join(' · '),
        plan.value ? t(`${plan.value.name}: ${plan.value.done} of ${plan.value.total} visits`, `${plan.value.name}: ${plan.value.done} de ${plan.value.total} visitas`) : t('No care plan', 'Sin plan de cuidados'),
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
      <UiBtn v-if="store" :disabled="busy || loading || !scored.length" data-cy="progress-report" :data-pdf-result="lastResult" @click="report">
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>
        {{ busy ? t('Preparing…', 'Preparando…') : t('Progress report', 'Informe de revisión') }}
      </UiBtn>
    </div>

    <div v-if="loading" class="space-y-3"><UiSkeleton class="h-20 w-full rounded-card" /><UiSkeleton class="h-56 w-full rounded-card" /></div>

    <div v-else-if="!scored.length" class="rounded-card border border-dashed border-line-control p-8 text-center text-[13.5px] text-ink-muted" data-cy="progress-empty">
      {{ t('No pain scores yet. They are tapped beside the visit note on My Day, or given by the patient when they check in.', 'Aún no hay dolor registrado. Se marca junto a la nota en Mi día, o lo da el paciente al registrar su llegada.') }}
    </div>

    <template v-else>
      <div class="grid gap-3" :class="compact ? 'grid-cols-3 gap-2' : 'grid-cols-1 sm:grid-cols-3'" data-pdf-block="kpis">
        <div class="rounded-card border border-line bg-surface shadow-card" :class="compact ? 'p-2.5' : 'p-4'" data-pdf-kpi>
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted" data-pdf-label>{{ t('Pain now', 'Dolor ahora') }}</p>
          <p class="mt-1.5 font-mono text-[24px] font-semibold text-ink-900" data-pdf-value data-cy="progress-latest">{{ latest }}<span class="text-[13px] font-normal text-ink-muted">/10</span></p>
          <p class="text-[12px] text-ink-muted" data-pdf-note>{{ day(scored[scored.length - 1]!.startsAt) }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface shadow-card" :class="compact ? 'p-2.5' : 'p-4'" data-pdf-kpi>
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted" data-pdf-label>{{ t('When they started', 'Al empezar') }}</p>
          <p class="mt-1.5 font-mono text-[24px] font-semibold text-ink-900" data-pdf-value>{{ first }}<span class="text-[13px] font-normal text-ink-muted">/10</span></p>
          <p class="text-[12px] text-ink-muted" data-pdf-note>{{ day(scored[0]!.startsAt) }}</p>
        </div>
        <div class="rounded-card border border-line bg-surface shadow-card" :class="compact ? 'p-2.5' : 'p-4'" data-pdf-kpi>
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted" data-pdf-label>{{ t('Change', 'Cambio') }}</p>
          <p class="mt-1.5 font-mono text-[24px] font-semibold" :class="change === null ? 'text-ink-900' : change < 0 ? 'text-success-text' : change > 0 ? 'text-danger-text' : 'text-ink-900'" data-pdf-value data-cy="progress-change">
            {{ change === null ? '—' : change > 0 ? `+${change}` : change }}
          </p>
          <p class="text-[12px] text-ink-muted" data-pdf-note>{{ t(`${scored.length} visits scored`, `${scored.length} visitas con dolor`) }}</p>
        </div>
      </div>

      <section class="rounded-card border border-line bg-surface p-4 shadow-card" data-pdf-block="image" data-pdf-span="12">
        <h3 class="text-[14px] font-semibold text-ink-900">{{ t('Pain by visit', 'Dolor por visita') }}</h3>
        <svg :viewBox="`0 0 ${W} ${H}`" class="mt-2 block h-auto w-full" role="img" :aria-label="t(`Pain from ${first} to ${latest} over ${scored.length} visits`, `Dolor de ${first} a ${latest} en ${scored.length} visitas`)" data-cy="progress-chart">
          <g v-for="g in gridY" :key="g.v">
            <line :x1="PAD.l" :x2="W - PAD.r" :y1="g.y" :y2="g.y" class="stroke-line" stroke-width="1" />
            <text :x="PAD.l - 8" :y="g.y + 4" text-anchor="end" class="fill-ink-faint font-mono" font-size="11">{{ g.v }}</text>
          </g>
          <polyline v-if="points.length > 1" :points="line" fill="none" class="stroke-brand" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
          <g v-for="(p, i) in points" :key="p.r.id">
            <circle :cx="p.x" :cy="p.y" r="4.5" class="fill-surface stroke-brand" stroke-width="2" />
            <text v-if="i === 0 || i === points.length - 1 || i % labelEvery === 0" :x="p.x" :y="H - 8" text-anchor="middle" class="fill-ink-muted" font-size="11">{{ new Date(p.r.startsAt).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' }) }}</text>
          </g>
        </svg>
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

    <PostureSection v-if="!loading" :patient-id="patientId" :can="can" class="mt-2" />
  </div>
</template>
