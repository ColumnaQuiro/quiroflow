<script setup lang="ts">
import { markerForVisit, visitMarkerLabel, type CarePlanVisitMarker } from '../../utils/carePlanVisitMarkers'
import { carePlanCadenceLabel } from '../../utils/carePlanCadence'
import { patientAge } from '../../utils/patientAge'
import { pregnancyProgress, pregnancyWeeksLabel } from '../../utils/pregnancy'
import { clinicDateOf, DEFAULT_CLINIC_TIMEZONE } from '../../utils/clinicClock'
import { formatEur } from '../../utils/billing'
import { openEndedPlanLabel } from '../../utils/planRenewal'

// The patient beside the visit, on My Day: what a practitioner must not miss
// while treating, kept in view instead of under the note. PracticeHub's
// patient view has the same fixed column -- photo, age, the visit and care
// plan figures, then the flags -- and clinics coming from it looked for the
// red flags there and found them two screens down.
//
// Order is by what goes wrong if it is missed: alerts first (red, yellow,
// pregnancy), then the patient's own note, then where they are in the plan
// and whether the next re-exam and visit are booked, then money and
// paperwork. Everything is read from the record; nothing here is a copy.
//
// Three layouts of the same content:
//   rail  -- the fixed column beside the note, from lg.
//   wide  -- the next patient, between visits: the sections side by side.
//   bar   -- below lg, where there is no room for a column: the red flags
//            and a row of chips, pinned over the note, the rest one tap away.
const props = withDefaults(
  defineProps<{
    patientId: string
    appointmentId: string
    startsAt: string
    /** Watched so the figures follow a visit being signed. */
    status?: string
    /** "10:15 · Ajuste · Sala 1", the visit as the list shows it. */
    visitLine?: string
    variant?: 'rail' | 'wide' | 'bar'
  }>(),
  { status: '', visitLine: '', variant: 'rail' },
)

const supabase = useSupabaseClient()
const t = useT()
const { can } = usePermission()
const { formatWeekdayDate } = useDates()

interface PatientRow {
  first_name: string
  last_name: string | null
  date_of_birth: string | null
  gender: string | null
  photo_storage_path: string | null
  chief_complaint: string | null
  diagnosis: string | null
  red_flags: string | null
  yellow_flags: string | null
  sticky_note: string | null
  tags: string[]
  pregnancy_due_date: string | null
  pending_forms?: number
}
interface Plan {
  name: string
  total_visits: number | null
  started_at: string
  frequency_value: number
  frequency_unit: 'week' | 'month'
  visits_per_period?: number | null
  visit_markers?: CarePlanVisitMarker[] | null
}
interface Visit { id: string; starts_at: string; status: string }

const loading = ref(true)
const patient = ref<PatientRow | null>(null)
const plan = ref<Plan | null>(null)
const visits = ref<Visit[]>([])
const markerTypeNames = ref<Record<string, string>>({})

// Three reads that need nothing from each other: the record, its latest
// plan, and every visit the patient has had or has booked. The figures below
// are all counted from those, rather than one query each.
async function load() {
  const [{ data: p }, { data: plans }, { data: appts }] = await Promise.all([
    supabase
      .from('patients')
      .select('first_name, last_name, date_of_birth, gender, photo_storage_path, chief_complaint, diagnosis, red_flags, yellow_flags, sticky_note, tags, pregnancy_due_date, pending_forms')
      .eq('id', props.patientId)
      .maybeSingle(),
    supabase
      .from('care_plans')
      .select('name, total_visits, started_at, frequency_value, frequency_unit, visits_per_period, visit_markers')
      .eq('patient_id', props.patientId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase.from('appointments').select('id, starts_at, status').eq('patient_id', props.patientId).is('deleted_at', null).order('starts_at'),
  ])
  patient.value = (p as PatientRow | null) ?? null
  plan.value = (plans as Plan[] | null)?.[0] ?? null
  visits.value = (appts as Visit[] | null) ?? []
  loading.value = false
  const typeIds = [...new Set((plan.value?.visit_markers ?? []).map((m) => m.appointment_type_id).filter((id): id is string => !!id))]
  if (typeIds.length) {
    const { data: types } = await supabase.from('appointment_types').select('id, name').in('id', typeIds)
    markerTypeNames.value = Object.fromEntries(((types as { id: string; name: string }[] | null) ?? []).map((x) => [x.id, x.name]))
  }
}
watch(() => [props.patientId, props.status], load, { immediate: true })

const fin = usePatientFinancialSummary(() => props.patientId)
const canSeeDebt = computed(() => can('billing_history_view'))

const fullName = computed(() => `${patient.value?.first_name ?? ''} ${patient.value?.last_name ?? ''}`.trim())
const initials = computed(() => ((patient.value?.first_name?.[0] ?? '') + (patient.value?.last_name?.[0] ?? '')).toUpperCase() || '?')
const photoUrl = computed(() => (patient.value?.photo_storage_path ? supabase.storage.from('patient-photos').getPublicUrl(patient.value.photo_storage_path).data.publicUrl : null))
const ageSex = computed(() => {
  const parts: string[] = []
  const age = patientAge(patient.value?.date_of_birth)
  if (age !== null) parts.push(t(`${age} years`, `${age} años`))
  const g = patient.value?.gender
  if (g === 'female') parts.push(t('Female', 'Mujer'))
  else if (g === 'male') parts.push(t('Male', 'Hombre'))
  else if (g === 'other') parts.push(t('Other', 'Otro'))
  return parts.join(' · ')
})

// --- Alerts -----------------------------------------------------------------
const redFlags = computed(() => patient.value?.red_flags?.trim() || '')
const yellowFlags = computed(() => patient.value?.yellow_flags?.trim() || '')
const complaint = computed(() => patient.value?.chief_complaint?.trim() || '')
const diagnosis = computed(() => patient.value?.diagnosis?.trim() || '')
const stickyNote = computed(() => patient.value?.sticky_note?.trim() || '')
const today = clinicDateOf(new Date(), DEFAULT_CLINIC_TIMEZONE)
// Pregnant now, or delivered in the last two weeks: a contraindication to
// some techniques either way, which is why it sits with the flags.
const pregnancy = computed(() => {
  const due = patient.value?.pregnancy_due_date
  if (!due) return null
  const p = pregnancyProgress(due, today)
  return p.daysToDue >= -14 ? p : null
})
const alertTone = computed<'danger' | 'warning' | 'neutral'>(() => (redFlags.value ? 'danger' : yellowFlags.value || pregnancy.value ? 'warning' : 'neutral'))

// --- Visits and plan ---------------------------------------------------------
const attended = (v: Visit) => v.status !== 'cancelled' && v.status !== 'no_show'
const visitNumber = computed(() => visits.value.filter((v) => v.status !== 'cancelled' && v.starts_at <= props.startsAt).length)
const completed = computed(() => visits.value.filter((v) => v.status === 'completed').length)
const missed = computed(() => visits.value.filter((v) => v.status === 'no_show').length)
const lastVisit = computed(() => [...visits.value].reverse().find((v) => v.status === 'completed' && v.starts_at < props.startsAt) ?? null)
const ahead = computed(() => visits.value.filter((v) => v.status === 'booked' && v.starts_at > props.startsAt))
const nextVisit = computed(() => ahead.value[0] ?? null)

// The visit's place in the plan, counted the way the plan's markers are
// (care_plan_marked_visits): every visit since it started that was not
// cancelled or missed, this one included.
const planVisit = computed(() => (plan.value ? visits.value.filter((v) => attended(v) && v.starts_at >= plan.value!.started_at && v.starts_at <= props.startsAt).length : 0))
// A plan with no end is never "done": its next visit is always due.
const openEnded = computed(() => !!plan.value && plan.value.total_visits === null)
const planLeft = computed(() => (!plan.value ? 0 : plan.value.total_visits === null ? 1 : Math.max(0, plan.value.total_visits - planVisit.value)))
const planPct = computed(() => (plan.value?.total_visits ? Math.min(100, Math.round((planVisit.value / plan.value.total_visits) * 100)) : 0))

function markerName(m: CarePlanVisitMarker) {
  return visitMarkerLabel({ label: m.label, expected_type_name: m.appointment_type_id ? markerTypeNames.value[m.appointment_type_id] : null }, t)
}
const todayMarker = computed(() => (plan.value ? markerForVisit(plan.value.visit_markers, planVisit.value) : null))
// The next marked visit after this one: its number, and the booked visit that
// will be it, if enough are booked -- PracticeHub's "Progress report: Not
// booked" is the case where none is.
const nextMarker = computed(() => {
  if (!plan.value) return null
  let best: { n: number; marker: CarePlanVisitMarker } | null = null
  for (const m of plan.value.visit_markers ?? []) {
    let n = m.at
    if (n <= planVisit.value) {
      if (!m.every) continue
      n = m.at + Math.ceil((planVisit.value + 1 - m.at) / m.every) * m.every
    }
    if (!best || n < best.n) best = { n, marker: m }
  }
  if (!best) return null
  return { ...best, booked: ahead.value[best.n - planVisit.value - 1] ?? null }
})
const markerPct = computed(() => (plan.value?.total_visits && nextMarker.value ? Math.min(100, ((nextMarker.value.n - 0.5) / plan.value.total_visits) * 100) : null))

const lastVisitLine = computed(() => {
  const v = lastVisit.value
  if (!v) return ''
  const days = Math.round((Date.parse(props.startsAt.slice(0, 10)) - Date.parse(v.starts_at.slice(0, 10))) / 86_400_000)
  const ago = days <= 0 ? t('today', 'hoy') : days === 1 ? t('yesterday', 'ayer') : t(`${days} days ago`, `hace ${days} días`)
  return `${formatWeekdayDate(v.starts_at)} · ${ago}`
})

// --- Money and paperwork -----------------------------------------------------
const bonos = computed(() => fin.activePackages.value.filter((b) => b.sessions_total > 0).map((b) => ({ id: b.id, name: b.package_name, left: Math.max(0, b.sessions_total - b.sessions_used) })))
const owed = computed(() => (canSeeDebt.value && !fin.loading.value && !fin.loadError.value ? fin.outstandingCents.value : 0))
const pendingForms = computed(() => patient.value?.pending_forms ?? 0)

// --- Editing, in place -------------------------------------------------------
const editingFlags = ref(false)
const editingNote = ref(false)
async function afterEdit() {
  editingFlags.value = false
  editingNote.value = false
  await load()
}

// Below lg: the chips stand for the sections, which open on demand.
const expanded = ref(false)
const barChips = computed(() => {
  const chips: { key: string; text: string; tone: 'danger' | 'warning' | 'brand' | 'neutral' }[] = []
  if (yellowFlags.value) chips.push({ key: 'yellow', text: t('Yellow flag', 'Alerta amarilla'), tone: 'warning' })
  if (pregnancy.value) chips.push({ key: 'pregnancy', text: `${t('Pregnant', 'Embarazo')} ${pregnancyWeeksLabel(pregnancy.value, t)}`, tone: 'warning' })
  if (todayMarker.value) chips.push({ key: 'marker', text: `${markerName(todayMarker.value)} ${t('today', 'hoy')}`, tone: 'warning' })
  if (owed.value > 0) chips.push({ key: 'owed', text: formatEur(owed.value), tone: 'danger' })
  if (stickyNote.value) chips.push({ key: 'note', text: t('Note', 'Nota'), tone: 'neutral' })
  if (pendingForms.value > 0) chips.push({ key: 'forms', text: t(`${pendingForms.value} form${pendingForms.value === 1 ? '' : 's'}`, `${pendingForms.value} formulario${pendingForms.value === 1 ? '' : 's'}`), tone: 'warning' })
  return chips
})
const CHIP_TONE = { danger: 'bg-danger-bg text-danger-text', warning: 'bg-warning-bg text-warning-text', brand: 'bg-brand-tint text-brand-text', neutral: 'bg-chip-bg text-chip-text' } as const
</script>

<template>
  <div class="text-ink-700" :data-variant="variant" data-cy="patient-rail">
    <div v-if="loading" class="space-y-3 p-4" aria-busy="true">
      <div class="flex items-center gap-3"><UiSkeleton class="h-12 w-12 rounded-full" /><div class="flex-1 space-y-1.5"><UiSkeleton class="h-4 w-36 rounded-ctlSm" /><UiSkeleton class="h-3 w-24 rounded-ctlSm" /></div></div>
      <UiSkeleton class="h-24 w-full rounded-card" />
      <UiSkeleton class="h-32 w-full rounded-card" />
    </div>

    <template v-else-if="patient">
      <!-- Who -->
      <!-- Wraps in the wide layout, so on a phone the next patient's actions
      take a line of their own instead of cutting the name to its first word. -->
      <div class="flex items-center gap-3" :class="variant === 'bar' ? 'px-3 pt-3' : variant === 'wide' ? 'flex-wrap gap-y-3' : 'px-4 pt-4'">
        <span class="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-tint font-[650] text-brand-text" :class="variant === 'bar' ? 'h-9 w-9 text-[12.5px]' : 'h-12 w-12 text-[15px]'">
          <img v-if="photoUrl" :src="photoUrl" alt="" class="h-full w-full object-cover" />
          <template v-else>{{ initials }}</template>
        </span>
        <div class="min-w-0 flex-1" :class="variant === 'wide' ? 'basis-[14rem]' : ''">
          <p class="truncate font-[640] leading-tight tracking-tightTitle text-ink-900" :class="variant === 'bar' ? 'text-[15px]' : 'text-[15.5px]'" data-cy="rail-name">{{ fullName }}</p>
          <p class="mt-0.5 text-[12.5px] text-ink-muted2" :class="variant === 'wide' ? '' : 'truncate'">
            <template v-if="ageSex">{{ ageSex }}</template>
            <template v-if="variant !== 'rail' && visitLine">{{ ageSex ? ' · ' : '' }}{{ t('Visit', 'Visita') }} <span class="font-mono">{{ visitNumber }}</span> · {{ visitLine }}</template>
          </p>
        </div>
        <slot name="actions" />
      </div>
      <div v-if="variant === 'rail'" class="flex items-center justify-between gap-2 px-4 pt-1.5">
        <p class="min-w-0 truncate text-[12px] text-ink-muted2">{{ t('Visit', 'Visita') }} <span class="font-mono text-ink-700">{{ visitNumber }}</span><template v-if="visitLine"> · {{ visitLine }}</template></p>
        <NuxtLink :to="`/patients/${patientId}`" target="_blank" class="shrink-0 text-[12px] font-semibold text-brand-text hover:text-brand-hover" data-cy="rail-profile">{{ t('Record', 'Ver ficha') }}</NuxtLink>
      </div>

      <!-- Below lg: the red flags themselves, then a chip for each other thing. -->
      <template v-if="variant === 'bar'">
        <button
          type="button"
          class="mx-3 mt-2.5 flex w-[calc(100%-1.5rem)] items-start gap-2 rounded-card border px-3 py-2 text-left"
          :class="redFlags ? 'border-danger-border bg-danger-bg' : 'border-line bg-surface-subtle'"
          :aria-expanded="expanded"
          data-cy="rail-bar-alerts"
          @click="expanded = !expanded"
        >
          <svg v-if="redFlags" aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" class="mt-px shrink-0 text-danger-text"><path d="M8 2.2L14.3 13H1.7z" /><path d="M8 6.5v3M8 11.3v.2" stroke-linecap="round" /></svg>
          <span class="min-w-0 flex-1 text-[13.5px] leading-snug" :class="redFlags ? 'line-clamp-2 font-medium text-ink-900' : 'text-ink-muted2'" data-cy="rail-red-flags">{{ redFlags || t('No red flags recorded.', 'Sin alertas rojas registradas.') }}</span>
          <span class="mt-px shrink-0 text-[12px] font-semibold text-brand-text">{{ expanded ? t('Hide', 'Ocultar') : t('All', 'Ver todo') }}</span>
        </button>
        <div v-if="barChips.length" class="flex gap-1.5 overflow-x-auto px-3 pb-2.5 pt-2" data-cy="rail-chips">
          <span v-for="c in barChips" :key="c.key" class="inline-flex h-7 shrink-0 items-center rounded-pill px-2.5 text-[12px] font-semibold" :class="[CHIP_TONE[c.tone], c.key === 'owed' ? 'font-mono' : '']" :data-cy="`rail-chip-${c.key}`">{{ c.text }}</span>
        </div>
        <div v-else class="h-2.5" />
      </template>

      <div
        v-if="variant !== 'bar' || expanded"
        :class="variant === 'wide' ? 'mt-4 grid gap-3 lg:grid-cols-3' : variant === 'bar' ? 'flex flex-col gap-3.5 border-t border-line-divider px-3 py-3' : 'flex flex-col gap-3.5 px-4 pb-5 pt-3.5'"
      >
        <!-- Alerts: first, tinted only when there is something in them. -->
        <div class="flex flex-col gap-3">
          <PatientsFlagsPanel v-if="editingFlags" :patient-id="patientId" start-editing @done="afterEdit" />
          <section
            v-else-if="variant !== 'bar' || !redFlags || yellowFlags || complaint || diagnosis || pregnancy"
            :aria-label="t('Alerts', 'Alertas')"
            class="flex flex-col gap-2.5 rounded-card border p-3"
            :class="alertTone === 'danger' ? 'border-danger-border bg-danger-bg' : alertTone === 'warning' ? 'border-warning-border bg-warning-bg2' : 'border-line bg-surface-subtle'"
            data-cy="rail-alerts"
            :data-tone="alertTone"
          >
            <div class="flex items-center gap-1.5">
              <svg v-if="alertTone !== 'neutral'" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" :class="alertTone === 'danger' ? 'text-danger-text' : 'text-warning-accent'"><path d="M8 2.2L14.3 13H1.7z" /><path d="M8 6.5v3M8 11.3v.2" stroke-linecap="round" /></svg>
              <h2 class="text-[13.5px] font-[640]" :class="alertTone === 'danger' ? 'text-danger-text' : alertTone === 'warning' ? 'text-warning-text' : 'text-ink-700'">{{ t('Alerts', 'Alertas') }}</h2>
              <button v-if="can('patients_edit')" type="button" class="ml-auto text-[12px] font-semibold text-brand-text hover:text-brand-hover touch:-my-2 touch:py-2" data-cy="rail-alerts-edit" @click="editingFlags = true">{{ t('Edit', 'Editar') }}</button>
            </div>
            <p v-if="redFlags && variant !== 'bar'" class="flex gap-2 text-[13px] font-medium leading-snug text-ink-900" data-cy="rail-red-flags">
              <span class="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-danger-text" aria-hidden="true" /><span class="sr-only">{{ t('Red flag:', 'Alerta roja:') }}</span><span class="whitespace-pre-wrap">{{ redFlags }}</span>
            </p>
            <p v-if="yellowFlags" class="flex gap-2 text-[13px] leading-snug text-ink-600" data-cy="rail-yellow-flags">
              <span class="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-warning-accent" aria-hidden="true" /><span class="sr-only">{{ t('Yellow flag:', 'Alerta amarilla:') }}</span><span class="whitespace-pre-wrap">{{ yellowFlags }}</span>
            </p>
            <p v-if="pregnancy" class="flex gap-2 text-[13px] leading-snug text-ink-600" data-cy="rail-pregnancy">
              <span class="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-warning-accent" aria-hidden="true" />{{ pregnancy.daysToDue >= 0 ? `${t('Pregnant', 'Embarazada')} · ${pregnancyWeeksLabel(pregnancy, t)}` : t('Recently gave birth', 'Parto reciente') }}
            </p>
            <p v-if="alertTone === 'neutral'" class="text-[12.5px] text-ink-muted2">{{ t('No red or yellow flags recorded.', 'Sin alertas rojas ni amarillas.') }}</p>
            <dl v-if="complaint || diagnosis" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-[12.5px] leading-snug" :class="alertTone === 'danger' ? 'border-t border-danger-border pt-2' : alertTone === 'warning' ? 'border-t border-warning-border pt-2' : 'border-t border-line-divider pt-2'">
              <template v-if="complaint"><dt class="text-ink-muted2">{{ t('Complaint', 'Motivo') }}</dt><dd class="text-ink-700" data-cy="rail-complaint">{{ complaint }}</dd></template>
              <template v-if="diagnosis"><dt class="text-ink-muted2">{{ t('Diagnosis', 'Diagnóstico') }}</dt><dd class="text-ink-700">{{ diagnosis }}</dd></template>
            </dl>
          </section>

          <PatientsStickyNotePanel v-if="editingNote" :patient-id="patientId" start-editing @done="afterEdit" />
          <section v-else-if="stickyNote" :aria-label="t('Patient note', 'Nota del paciente')" class="flex gap-2 rounded-card border border-warning-border bg-warning-bg2 px-3 py-2.5" data-cy="rail-sticky-note">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="mt-0.5 shrink-0 text-warning-text"><path d="M3 2.5h10v7l-4 4H3z" stroke-linejoin="round" /><path d="M9 13.5v-4h4" /></svg>
            <p class="min-w-0 flex-1 whitespace-pre-wrap text-[12.5px] leading-snug text-ink-600">{{ stickyNote }}</p>
            <button v-if="can('patients_edit')" type="button" class="shrink-0 self-start text-[12px] font-semibold text-brand-text hover:text-brand-hover" :aria-label="t('Edit the patient note', 'Editar la nota del paciente')" @click="editingNote = true">{{ t('Edit', 'Editar') }}</button>
          </section>
          <button v-else-if="can('patients_edit')" type="button" class="self-start text-[12px] font-semibold text-brand-text hover:text-brand-hover touch:py-2" data-cy="rail-sticky-note-add" @click="editingNote = true">{{ t('+ Patient note', '+ Nota del paciente') }}</button>
        </div>

        <!-- Where they are in the plan, and what is (not) booked. -->
        <section :aria-label="t('Care plan', 'Plan de cuidado')" class="flex flex-col gap-2" :class="variant === 'wide' ? 'rounded-card border border-line-divider bg-surface-subtle p-3' : ''" data-cy="rail-plan">
          <div class="flex items-baseline justify-between gap-2">
            <h2 class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ t('Care plan', 'Plan de cuidado') }}</h2>
            <span v-if="plan" class="truncate text-[12px] text-ink-muted2">{{ carePlanCadenceLabel(plan, t) }}</span>
          </div>
          <template v-if="plan">
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate text-[13px] font-semibold text-ink-900">{{ plan.name }}</span>
              <span v-if="!openEnded" class="shrink-0 text-[12.5px] text-ink-muted2" data-cy="rail-plan-position"><span class="font-mono font-semibold text-ink-900">{{ planVisit }}</span> {{ t('of', 'de') }} <span class="font-mono">{{ plan.total_visits }}</span></span>
            </div>
            <p v-if="openEnded" class="text-[12.5px] text-ink-muted2 first-letter:uppercase" data-cy="rail-plan-position">{{ openEndedPlanLabel(planVisit, plan.started_at, t) }}</p>
            <div v-else class="relative h-[6px] rounded-full bg-line-faint">
              <div class="absolute inset-y-0 left-0 rounded-full bg-brand" :style="{ width: `${planPct}%` }" />
              <div v-if="markerPct !== null" class="absolute -top-[3px] h-3 w-[3px] rounded-sm bg-warning-accent" :style="{ left: `${markerPct}%` }" aria-hidden="true" />
            </div>
          </template>
          <p v-else class="text-[12.5px] text-ink-faint">{{ t('No care plan yet.', 'Sin plan de cuidado.') }}</p>

          <dl class="mt-1 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 text-[12.5px]">
            <template v-if="todayMarker || nextMarker">
              <dt class="text-ink-muted2">{{ markerName((todayMarker ?? nextMarker!.marker)) }}</dt>
              <dd class="flex justify-end" data-cy="rail-reexam">
                <UiPill v-if="todayMarker" tone="warning" dot>{{ t(`Today · visit ${planVisit}`, `Hoy · visita ${planVisit}`) }}</UiPill>
                <span v-else-if="nextMarker!.booked" class="text-ink-700">{{ t('Visit', 'Visita') }} <span class="font-mono">{{ nextMarker!.n }}</span> · {{ formatWeekdayDate(nextMarker!.booked.starts_at) }}</span>
                <UiPill v-else tone="danger" dot>{{ t(`Visit ${nextMarker!.n} · not booked`, `Visita ${nextMarker!.n} · sin reservar`) }}</UiPill>
              </dd>
            </template>
            <dt class="text-ink-muted2">{{ t('Last visit', 'Última visita') }}</dt>
            <dd class="text-right text-ink-700" data-cy="rail-last-visit">{{ lastVisitLine || '—' }}</dd>
            <dt class="text-ink-muted2">{{ t('Next visit', 'Próxima visita') }}</dt>
            <dd class="flex justify-end" data-cy="rail-next-visit">
              <span v-if="nextVisit" class="truncate text-ink-700">{{ formatWeekdayDate(nextVisit.starts_at) }}</span>
              <UiPill v-else-if="planLeft > 0" tone="danger" dot>{{ t('Not booked', 'Sin reservar') }}</UiPill>
              <span v-else class="text-ink-faint">—</span>
            </dd>
            <dt class="text-ink-muted2">{{ t('Booked ahead', 'Reservadas') }}</dt>
            <dd class="text-right text-ink-700" data-cy="rail-booked"><span class="font-mono">{{ ahead.length }}</span><template v-if="plan && !openEnded && planLeft > 0"> <span class="text-ink-muted2">{{ t(`of ${planLeft} left`, `de ${planLeft} que faltan`) }}</span></template></dd>
            <dt class="text-ink-muted2">{{ t('Attendance', 'Asistencia') }}</dt>
            <dd class="text-right text-ink-700" data-cy="rail-attendance"><span class="font-mono">{{ completed }}</span> {{ t('done', 'hechas') }}<template v-if="missed"> · <span class="font-mono text-danger-text">{{ missed }}</span> {{ missed === 1 ? t('missed', 'falta') : t('missed', 'faltas') }}</template></dd>
          </dl>
        </section>

        <!-- Money and paperwork. -->
        <section v-if="owed > 0 || bonos.length || pendingForms > 0 || patient.tags.length" :aria-label="t('Account', 'Cuenta')" class="flex flex-col gap-2" :class="variant === 'wide' ? 'rounded-card border border-line-divider bg-surface-subtle p-3' : 'border-t border-line-divider pt-3'">
          <h2 class="text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ owed > 0 || bonos.length || pendingForms > 0 ? t('Account', 'Cuenta') : t('Tags', 'Etiquetas') }}</h2>
          <dl v-if="owed > 0 || bonos.length || pendingForms > 0" class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 text-[12.5px]">
            <template v-if="owed > 0">
              <dt class="text-ink-muted2">{{ t('Owed', 'Pendiente') }}</dt>
              <dd class="flex justify-end"><span class="rounded-[6px] bg-danger-bg px-2 py-0.5 font-mono text-[12px] font-semibold text-danger-text" data-cy="rail-owed">{{ formatEur(owed) }}</span></dd>
            </template>
            <template v-for="b in bonos" :key="b.id">
              <dt class="truncate text-ink-muted2">{{ b.name }}</dt>
              <dd class="text-right" data-cy="rail-bono"><span v-if="b.left <= 1" class="font-semibold text-warning-text"><span class="font-mono">{{ b.left }}</span> {{ b.left === 1 ? t('left', 'restante') : t('left', 'restantes') }}</span><span v-else class="text-ink-700"><span class="font-mono">{{ b.left }}</span> {{ t('left', 'restantes') }}</span></dd>
            </template>
            <template v-if="pendingForms > 0">
              <dt class="text-ink-muted2">{{ t('Forms', 'Formularios') }}</dt>
              <dd class="flex justify-end"><UiPill tone="warning" data-cy="rail-forms">{{ t(`${pendingForms} not completed`, `${pendingForms} sin completar`) }}</UiPill></dd>
            </template>
          </dl>
          <div v-if="patient.tags.length" class="flex flex-wrap gap-1.5" :class="owed > 0 || bonos.length || pendingForms > 0 ? 'pt-1' : ''">
            <span v-for="tag in patient.tags" :key="tag" class="rounded-pill border border-chip-border bg-chip-bg px-2 py-0.5 text-[11px] font-semibold text-chip-text">{{ tag }}</span>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
