<script setup lang="ts">
import { formatLongDate } from '~/utils/billing'
import { parseVisitNote, visitNotePreview } from '~/utils/visitNote'
import type { Tables } from '~/types/database.types'

// Everything clinical, on one surface, in the order a practitioner reads it.
//
// The band across the top is what you need before the patient is in the
// room: what they came in for, what you think it is, and anything that
// should stop you. Below it, the notes on the left and the plan on the
// right -- the last visit expanded, because "what did I do last time" is
// the question, and the ones before it collapsed to a line each.
//
// Notes are stored as one text column but written in four labelled
// sections; utils/visitNote knows the convention, and that is why this can
// render them with their structure rather than as a wall of text with the
// labels still in it.
const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const t = useT()
const { can } = usePermission()

const patient = ref<Pick<Tables<'patients'>, 'chief_complaint' | 'diagnosis' | 'red_flags' | 'yellow_flags' | 'goals'> | null>(null)

interface NoteRow {
  id: string
  body: string
  created_at: string
  appointment_id: string
  appointments: {
    starts_at: string
    appointment_types: { name: string } | null
    team_members: { full_name: string } | null
    practitioner_name: string | null
  } | null
}
const notes = ref<NoteRow[]>([])
const loading = ref(true)
const expandedId = ref<string | null>(null)
const notesAppointmentId = ref<string | null>(null)
// The band displays; the panel edits. Showing the panel beside the band put
// the same five columns on screen twice.
const editingClinical = ref(false)
const latestAppointmentId = ref<string | null>(null)

async function load() {
  loading.value = true
  const [{ data: p }, { data: rows }, { data: appts }] = await Promise.all([
    supabase.from('patients').select('chief_complaint, diagnosis, red_flags, yellow_flags, goals').eq('id', props.patientId).maybeSingle(),
    supabase
      .from('visit_notes')
      .select('id, body, created_at, appointment_id, appointments!inner(starts_at, patient_id, appointment_types(name), team_members(full_name), practitioner_name)')
      .eq('appointments.patient_id', props.patientId),
    // A note belongs to an appointment -- there is no such thing as a
    // free-floating one -- so "Add note" needs the visit to attach it to.
    supabase
      .from('appointments')
      .select('id')
      .eq('patient_id', props.patientId)
      .is('deleted_at', null)
      .order('starts_at', { ascending: false })
      .limit(1),
  ])
  patient.value = p
  // Newest VISIT first. Ordering by the note's own created_at puts a
  // back-dated or late-written note in the wrong place -- and it is the
  // visit date the row displays, so the two must agree.
  notes.value = ((rows as unknown as NoteRow[]) ?? []).slice().sort((a, b) => {
    const at = a.appointments?.starts_at ?? a.created_at
    const bt = b.appointments?.starts_at ?? b.created_at
    return bt.localeCompare(at)
  })
  latestAppointmentId.value = appts?.[0]?.id ?? null
  // The newest note opens itself: it is the one being asked about.
  expandedId.value = notes.value[0]?.id ?? null
  loading.value = false
}
onMounted(load)
watch(() => props.patientId, load)

function authorOf(note: NoteRow) {
  return note.appointments?.team_members?.full_name ?? note.appointments?.practitioner_name ?? null
}
function visitDate(note: NoteRow) {
  return formatLongDate(note.appointments?.starts_at ?? note.created_at)
}
function visitType(note: NoteRow) {
  return note.appointments?.appointment_types?.name ?? null
}

const SECTION_LABELS = computed<Record<string, string>>(() => ({
  Subjective: t('Subjective', 'Subjetivo'),
  Objective: t('Objective', 'Objetivo'),
  Action: t('Action', 'Actuación'),
  Plan: t('Plan', 'Plan'),
}))

// The flags are single free-text columns, so each renders as one pill
// carrying its own text. There is no count to show and splitting the prose
// to invent one would be a number nobody wrote.
const redFlags = computed(() => patient.value?.red_flags?.trim() || null)
const yellowFlags = computed(() => patient.value?.yellow_flags?.trim() || null)

const goalChips = computed(() =>
  (patient.value?.goals ?? '')
    .split(/[\n;,]+/)
    .map((g) => g.trim())
    .filter(Boolean),
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- The band. What you need before the patient is in the room, at full
         width so it is above the fold on any screen this app targets. -->
    <section aria-labelledby="clin-band" class="rounded-card border border-line bg-surface p-4 shadow-card">
      <h2 id="clin-band" class="sr-only">{{ t('Clinical summary', 'Resumen clínico') }}</h2>

      <div v-if="loading" class="flex flex-col gap-2">
        <UiSkeleton class="h-4 w-64 rounded" />
        <UiSkeleton class="h-4 w-48 rounded" />
      </div>

      <template v-else>
        <div class="mb-3 flex items-center justify-end">
          <UiBtn v-if="can('patients_edit')" variant="secondary" size="sm" @click="editingClinical = true">
            {{ t('Edit clinical details', 'Editar datos clínicos') }}
          </UiBtn>
        </div>
        <dl class="grid gap-4 sm:grid-cols-2">
          <div>
            <dt class="text-[11.5px] uppercase tracking-[.04em] text-ink-muted2">{{ t('Chief complaint', 'Motivo de consulta') }}</dt>
            <!-- No onset date: the schema keeps the complaint as one text
                 column and has nowhere to put "since when". Recording it
                 needs a migration, not a guess from the first visit date. -->
            <dd class="mt-1 text-[15px] text-ink-900">{{ patient?.chief_complaint || t('Not recorded', 'Sin registrar') }}</dd>
          </div>
          <div>
            <dt class="text-[11.5px] uppercase tracking-[.04em] text-ink-muted2">{{ t('Working diagnosis', 'Diagnóstico de trabajo') }}</dt>
            <!-- Likewise no since-date and no author: diagnosis is a single
                 column with no history behind it. -->
            <dd class="mt-1 text-[15px] text-ink-900">{{ patient?.diagnosis || t('Not recorded', 'Sin registrar') }}</dd>
          </div>
        </dl>

        <div v-if="redFlags || yellowFlags" class="mt-3 flex flex-col gap-1.5 border-t border-line-divider pt-3">
          <p v-if="redFlags" class="flex items-start gap-2">
            <span class="mt-px shrink-0 rounded-pill bg-danger-bg px-2 py-0.5 text-[11px] font-semibold text-danger-text">
              {{ t('Red flag', 'Señal roja') }}
            </span>
            <span class="text-[13.5px] text-ink-700">{{ redFlags }}</span>
          </p>
          <p v-if="yellowFlags" class="flex items-start gap-2">
            <span class="mt-px shrink-0 rounded-pill bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning-text">
              {{ t('Yellow flag', 'Señal amarilla') }}
            </span>
            <span class="text-[13.5px] text-ink-700">{{ yellowFlags }}</span>
          </p>
        </div>
      </template>
    </section>

    <div class="flex flex-col gap-4 xl:flex-row xl:items-start">
      <!-- Notes: the last visit open, the rest a line each. -->
      <section aria-labelledby="clin-notes" class="min-w-0 flex-1 rounded-card border border-line bg-surface shadow-card">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line-divider px-4 py-3">
          <h2 id="clin-notes" class="text-[13.5px] font-semibold text-ink-700">
            {{ t('Visit notes', 'Notas de visita') }}
            <span v-if="!loading" class="ml-1 font-normal text-ink-faint">{{ notes.length }}</span>
          </h2>
          <!-- A note hangs off an appointment, so this opens the charting
               panel for the most recent one rather than pretending a note
               can exist on its own. -->
          <UiBtn
            v-if="can('patients_edit') && latestAppointmentId"
            variant="primary"
            size="sm"
            @click="notesAppointmentId = latestAppointmentId"
          >
            {{ t('Add note', 'Añadir nota') }}
          </UiBtn>
        </div>

        <div v-if="loading" class="space-y-3 p-4">
          <UiSkeleton v-for="i in 3" :key="i" class="h-10 rounded-ctl" />
        </div>

        <p v-else-if="notes.length === 0" class="px-4 py-8 text-center text-[13px] text-ink-faint">
          {{ t('No visit notes yet — these are written against an appointment.', 'Aún no hay notas — se escriben sobre una cita.') }}
        </p>

        <ul v-else class="divide-y divide-line-row">
          <li v-for="note in notes" :key="note.id" class="px-4 py-3">
            <button
              type="button"
              class="flex w-full items-baseline justify-between gap-3 text-left outline-none focus-visible:shadow-focus"
              :aria-expanded="expandedId === note.id"
              @click="expandedId = expandedId === note.id ? null : note.id"
            >
              <span class="min-w-0">
                <span class="text-[13px] font-medium text-ink-900">{{ visitDate(note) }}</span>
                <span v-if="visitType(note)" class="text-[12.5px] text-ink-muted2"> · {{ visitType(note) }}</span>
              </span>
              <span class="shrink-0 text-[12px] font-medium text-brand-text">
                {{ expandedId === note.id ? t('Close', 'Cerrar') : t('Open', 'Abrir') }}
              </span>
            </button>

            <p v-if="expandedId !== note.id" class="mt-0.5 truncate text-[12.5px] text-ink-muted2">
              {{ visitNotePreview(note.body) }}
            </p>

            <div v-else class="mt-2">
              <!-- Structured notes keep their structure. An unstructured one
                   is shown as written rather than forced into headings it
                   never had. -->
              <dl v-if="parseVisitNote(note.body).sections.length > 0" class="space-y-2">
                <div v-for="section in parseVisitNote(note.body).sections" :key="section.label">
                  <dt class="text-[11px] uppercase tracking-[.04em] text-ink-muted2">{{ SECTION_LABELS[section.label] }}</dt>
                  <dd class="mt-0.5 whitespace-pre-wrap text-[13.5px] text-ink-700">{{ section.text }}</dd>
                </div>
              </dl>
              <p v-if="parseVisitNote(note.body).preamble" class="mt-2 whitespace-pre-wrap text-[13.5px] text-ink-700">
                {{ parseVisitNote(note.body).preamble }}
              </p>

              <p class="mt-2.5 border-t border-line-divider pt-2 text-[11.5px] text-ink-faint">
                {{ authorOf(note) ?? t('Author not recorded', 'Autor sin registrar') }} ·
                {{ formatLongDate(note.created_at) }}
              </p>
            </div>
          </li>
        </ul>
      </section>

      <!-- The plan, and the goals it is working towards. -->
      <div class="flex w-full shrink-0 flex-col gap-4 xl:w-[340px]">
        <PatientsPhaseStats :patient-id="patientId" />

        <section aria-labelledby="clin-goals" class="rounded-card border border-line bg-surface p-4 shadow-card">
          <h2 id="clin-goals" class="text-[13.5px] font-semibold text-ink-700">{{ t('Goals', 'Objetivos') }}</h2>
          <!-- Goals are one free-text column, so they have no per-goal state
               to show and no outcome measures behind them. Rendering a
               from → to arrow here would mean inventing both numbers. -->
          <div v-if="goalChips.length > 0" class="mt-2.5 flex flex-wrap gap-1.5">
            <span v-for="goal in goalChips" :key="goal" class="rounded-pill bg-chip-bg px-2 py-0.5 text-[12px] text-chip-text">{{ goal }}</span>
          </div>
          <p v-else class="mt-2 text-[12.5px] text-ink-faint">{{ t('No goals recorded.', 'Sin objetivos registrados.') }}</p>
        </section>

        <PatientsStickyNotePanel :patient-id="patientId" />
      </div>
    </div>

    <div
      v-if="editingClinical"
      class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/40 p-4"
      @click.self="editingClinical = false; load()"
    >
      <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card bg-surface p-5 shadow-drawer">
        <div class="flex items-center justify-between">
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('Clinical details', 'Datos clínicos') }}</h2>
          <button type="button" :aria-label="t('Close', 'Cerrar')" class="text-ink-faint hover:text-ink-600" @click="editingClinical = false; load()">✕</button>
        </div>
        <div class="mt-4">
          <PatientsFlagsPanel :patient-id="patientId" />
        </div>
      </div>
    </div>

    <div v-if="notesAppointmentId" class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/40 p-4" @click.self="notesAppointmentId = null">
      <div class="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-card bg-surface p-6 shadow-drawer">
        <div class="flex items-center justify-between">
          <h2 class="text-[15px] font-semibold text-ink-900">{{ t('Visit notes', 'Notas de la visita') }}</h2>
          <button type="button" :aria-label="t('Close', 'Cerrar')" class="text-ink-faint hover:text-ink-600" @click="notesAppointmentId = null; load()">✕</button>
        </div>
        <div class="mt-4">
          <AppointmentsNotesPanel :appointment-id="notesAppointmentId" />
        </div>
      </div>
    </div>
  </div>
</template>
