<script setup lang="ts">
import { listingActionLine, listingSummary, sideLettersFor, type Listings } from '~/utils/spinalListings'
interface RoomOption { id: string; name: string }
interface Appointment {
  id: string
  patient_id: string
  room_id: string | null
  starts_at: string
  status: string
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; color: string } | null
}

// The visit being charted, on My Day. Who the patient is -- flags, note, plan,
// money -- is PractitionerPatientRail, a column of its own beside this from
// lg; below lg there is no room for one, so `pinnedPatient` puts the same
// rail, as a bar, at the top of this view where it stays while the note
// scrolls. What used to sit under the note (attendance, the plan card, the
// flags, the notes history and the files) is now either in that rail or on a
// tab, so the note is what fills the screen.
const props = defineProps<{ appointment: Appointment; rooms?: RoomOption[]; visitLine?: string; pinnedPatient?: boolean }>()
const emit = defineEmits<{ charted: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const signing = ref(false)
const { showToast } = useToast()

// PatientsExamAutofill owns the SOAP fields and the visit_notes save --
// this view just drives it (save on "Sign & complete", populate on "Copy
// last note") via the methods it exposes.
const examRef = ref<{
  save: () => Promise<void>
  copyLastNote: () => Promise<void>
  setListingLine: (line: string) => void
  bringSection: (section: 'Subjective' | 'Objective' | 'Action' | 'Plan' | 'Note', text: string) => void
} | null>(null)
const listingsRef = ref<{ setAll: (l: Listings) => void } | null>(null)
const store = useAccountStore()
const { can, restricted } = usePermission()
const canEditNotes = computed(() => can('visit_notes_edit'))
// A read-only calendar changes no appointment, its own visits included: the
// "staff update appointments" policy refuses it outright. So for that role the
// button signs the note and leaves completing the visit to someone who can,
// rather than offering "complete" and failing every time it is pressed.
const readOnlyCalendar = computed(() => restricted('calendar_read_only'))
const signLabel = computed(() => (signing.value ? t('Signing…', 'Firmando…') : readOnlyCalendar.value ? t('Sign note', 'Firmar nota') : t('Sign & complete', 'Firmar y completar')))

// The listing beside the note writes itself into Action as one line, kept in
// step as segments are tapped (utils/spinalListings).
function onListingsChange(l: Listings) {
  examRef.value?.setListingLine(listingActionLine(listingSummary(l, (x) => x, sideLettersFor(t)), t))
}

// Tabs. The note stays mounted under the others -- v-show, not v-if -- so a
// form answer brought over from Forms lands in a note that is still there,
// and nothing typed is lost by looking at the history. The others mount the
// first time they are opened, so a visit nobody reads the files of does not
// load them.
type Tab = 'note' | 'history' | 'files' | 'forms'
const tab = ref<Tab>('note')
const opened = ref<Set<Tab>>(new Set(['note']))
function openTab(next: Tab) {
  tab.value = next
  opened.value.add(next)
}
const TABS = computed<{ key: Tab; label: string }[]>(() => [
  { key: 'note', label: t("Today's note", 'Nota de hoy') },
  { key: 'history', label: t('History', 'Historial') },
  { key: 'files', label: t('Files', 'Archivos') },
  { key: 'forms', label: t('Forms', 'Formularios') },
])
// Roving focus across the tabs: one tab stop, arrows to move.
function onTabKeydown(e: KeyboardEvent) {
  const keys = TABS.value.map((x) => x.key)
  const i = keys.indexOf(tab.value)
  const next = e.key === 'ArrowRight' ? keys[(i + 1) % keys.length] : e.key === 'ArrowLeft' ? keys[(i - 1 + keys.length) % keys.length] : e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : null
  if (!next) return
  e.preventDefault()
  openTab(next)
  nextTick(() => (document.querySelector(`[data-cy="myday-tab-${next}"]`) as HTMLElement | null)?.focus())
}

// Laid out by the width this pane actually has, not the window's: the
// patient's column and the folded list sit beside it, so a viewport
// breakpoint would put the note into a sliver.
// Wide: note | listing, last visit open beside them. Medium: note | listing,
// last visit a line above. Narrow: one column, the listing in its own
// two-column grid.
const bodyEl = ref<HTMLElement | null>(null)
const bodyWidth = ref(0)
let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (!bodyEl.value) return
  resizeObserver = new ResizeObserver(([entry]) => (bodyWidth.value = entry?.contentRect.width ?? 0))
  resizeObserver.observe(bodyEl.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())
const layout = computed<'wide' | 'medium' | 'narrow'>(() => (bodyWidth.value >= 1040 ? 'wide' : bodyWidth.value >= 600 || !bodyWidth.value ? 'medium' : 'narrow'))

async function copyLastNote() {
  await examRef.value?.copyLastNote()
}

async function signAndComplete() {
  signing.value = true
  // Status first, note second: ExamAutofill's save() fires its own 'saved'
  // -> 'charted' reload the moment a first note is created, and that reload
  // re-fetches this appointment's status. Doing the status update after
  // that save would race it -- the reload can win and land before the
  // update commits, showing "Booked" until the next refresh. Flipping the
  // order means any reload the save triggers already sees "completed".
  //
  // Selected back: an update RLS refuses changes no row and reports no error,
  // and the button used to finish as if it had worked, the visit still
  // "Booked" and nothing on screen to say so. The note is saved either way.
  //
  // The two failures are told apart, because "try again" is only true of one
  // of them: an error is the request failing, and retrying can work; no row
  // changed is the database refusing this person, and retrying never will.
  try {
    if (readOnlyCalendar.value) {
      await examRef.value?.save()
      showToast(
        t(
          'Note signed. Your role has a read-only calendar, so the front desk marks the visit complete. To change that: Settings › Roles & Permissions.',
          'Nota firmada. Tu rol tiene el calendario en solo lectura, así que la visita la marca como completada recepción. Para cambiarlo: Ajustes › Roles y permisos.',
        ),
        'info',
        8000,
      )
      return
    }
    const { data: changed, error } = await supabase.from('appointments').update({ status: 'completed' }).eq('id', props.appointment.id).select('id')
    await examRef.value?.save()
    if (error) showToast(t("The note is saved, but the visit couldn't be marked complete. Try again.", 'La nota está guardada, pero no se ha podido completar la visita. Inténtalo de nuevo.'), 'error', 6000)
    else if (!changed?.length)
      showToast(
        t(
          "The note is saved, but your role can't change this appointment, so the visit wasn't marked complete. Ask the front desk to complete it.",
          'La nota está guardada, pero tu rol no tiene permiso para cambiar esta cita, así que la visita no se ha completado. Pide a recepción que la complete.',
        ),
        'error',
        8000,
      )
  } finally {
    signing.value = false
    emit('charted')
  }
}

function bring(section: 'Subjective' | 'Objective' | 'Action' | 'Plan' | 'Note', text: string) {
  examRef.value?.bringSection(section, text)
}
</script>

<template>
  <div class="flex min-h-full flex-col">
    <!-- Stays in view while the note scrolls: the patient below lg, the
    tabs, and Sign & complete. -->
    <div class="sticky top-0 z-10 border-b border-line bg-surface">
      <PractitionerPatientRail
        v-if="pinnedPatient"
        :patient-id="appointment.patient_id"
        :appointment-id="appointment.id"
        :starts-at="appointment.starts_at"
        :status="appointment.status"
        :visit-line="visitLine"
        variant="bar"
        class="border-b border-line-divider"
      />
      <!-- The actions drop to a line of their own when the pane is too narrow
      for both, rather than squeezing the tabs out of sight behind them. -->
      <div class="flex flex-wrap items-center gap-x-2 pr-3 sm:pr-4">
        <div role="tablist" :aria-label="t('Visit', 'Visita')" class="flex min-w-0 flex-[1_1_23rem] overflow-x-auto px-1.5 sm:px-2.5" @keydown="onTabKeydown">
          <button
            v-for="x in TABS"
            :key="x.key"
            type="button"
            role="tab"
            :aria-selected="tab === x.key"
            :tabindex="tab === x.key ? 0 : -1"
            :aria-controls="`myday-panel-${x.key}`"
            class="-mb-px flex h-12 shrink-0 items-center border-b-2 px-3 text-[13.5px] font-semibold"
            :class="tab === x.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700'"
            :data-cy="`myday-tab-${x.key}`"
            @click="openTab(x.key)"
          >
            {{ x.label }}
          </button>
        </div>
        <div class="ml-auto hidden shrink-0 items-center gap-2 py-2 pl-3 sm:flex">
          <UiBtn variant="secondary" size="sm" @click="copyLastNote">{{ t('Copy last note', 'Copiar última nota') }}</UiBtn>
          <UiBtn variant="primary" size="sm" :disabled="signing" data-cy="myday-sign" @click="signAndComplete">{{ signLabel }}</UiBtn>
        </div>
      </div>
    </div>

    <div ref="bodyEl" class="flex-1 p-3 sm:p-4" :data-layout="layout">
      <!-- Today's note -->
      <div v-show="tab === 'note'" id="myday-panel-note" role="tabpanel" class="flex flex-col gap-3">
        <!-- The plan is ending: the review, and what comes next. Nothing otherwise. -->
        <AppointmentsPlanRenewal
          v-if="store.accountId"
          :patient-id="appointment.patient_id"
          :account-id="store.accountId"
          :team-member-id="store.teamMember?.id ?? null"
          :editable="can('patients_edit')"
          :can-sell-bono="can('billing_access')"
          :report-to="`/patients/${appointment.patient_id}?tab=progress`"
        />
        <AppointmentsPreviousVisit
          v-if="layout !== 'wide'"
          :appointment-id="appointment.id"
          :editable="canEditNotes"
          collapsible
          @bring="bring"
          @use-listings="(l) => listingsRef?.setAll(l)"
        />
        <div class="grid gap-3" :class="layout === 'wide' ? 'grid-cols-[minmax(0,1fr)_300px]' : 'grid-cols-1'">
          <section class="min-w-0" data-cy="myday-today">
            <div class="grid gap-3" :class="layout === 'narrow' ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_236px]'">
              <div class="min-w-0 rounded-card border border-line bg-surface shadow-card">
                <AppointmentsPainScore
                  v-if="store.accountId"
                  class="border-b border-line-row px-5 py-3"
                  :appointment-id="appointment.id"
                  :account-id="store.accountId"
                  :team-member-id="store.teamMember?.id ?? null"
                  :editable="canEditNotes"
                />
                <PatientsExamAutofill ref="examRef" :appointment-id="appointment.id" :patient-id="appointment.patient_id" @saved="emit('charted')" />
              </div>
              <AppointmentsSpinalListings
                v-if="store.accountId"
                ref="listingsRef"
                class="self-start"
                :appointment-id="appointment.id"
                :account-id="store.accountId"
                :team-member-id="store.teamMember?.id ?? null"
                :editable="canEditNotes"
                default-open
                :narrow="layout !== 'narrow'"
                @change="onListingsChange"
              />
            </div>
          </section>
          <AppointmentsPreviousVisit
            v-if="layout === 'wide'"
            class="self-start"
            :appointment-id="appointment.id"
            :editable="canEditNotes"
            @bring="bring"
            @use-listings="(l) => listingsRef?.setAll(l)"
          />
        </div>
        <section class="rounded-card border border-line bg-surface p-4 shadow-card">
          <h3 class="text-[13.5px] font-semibold text-ink-700">{{ t('Quick Note', 'Nota rápida') }}</h3>
          <div class="mt-2.5">
            <AppointmentsNotesPanel :appointment-id="appointment.id" :listings="false" />
          </div>
        </section>
      </div>

      <div v-if="opened.has('history')" v-show="tab === 'history'" id="myday-panel-history" role="tabpanel" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <PatientsVisitNotesTab :patient-id="appointment.patient_id" />
      </div>
      <div v-if="opened.has('files')" v-show="tab === 'files'" id="myday-panel-files" role="tabpanel" class="rounded-card border border-line bg-surface p-4 shadow-card">
        <PatientsFilesTab :patient-id="appointment.patient_id" />
      </div>
      <!-- The intake and other completed forms, to bring into Subjective
           instead of retyping. -->
      <div v-if="opened.has('forms')" v-show="tab === 'forms'" id="myday-panel-forms" role="tabpanel">
        <AppointmentsFormAnswers :patient-id="appointment.patient_id" :editable="canEditNotes" show-empty @bring="bring" />
      </div>
    </div>

    <!-- On a phone the actions leave the tab row for the bottom of the
    screen, where a thumb reaches them. -->
    <div class="sticky bottom-0 z-10 flex gap-2 border-t border-line bg-surface p-3 sm:hidden">
      <UiBtn variant="secondary" size="lg" @click="copyLastNote">{{ t('Copy last', 'Copiar última') }}</UiBtn>
      <UiBtn variant="primary" size="lg" class="flex-1" :disabled="signing" data-cy="myday-sign-phone" @click="signAndComplete">{{ signLabel }}</UiBtn>
    </div>
  </div>
</template>
