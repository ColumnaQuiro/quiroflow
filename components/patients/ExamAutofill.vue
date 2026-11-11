<script setup lang="ts">
import { parseVisitNote } from '~/utils/visitNote'
import { syncListingLine } from '~/utils/spinalListings'
// First version of the chiropractic exam-finding grid, replicating the
// reference tool: pick a spine segment + side, an optional directional
// modifier, then a finding code -- each click appends one line to
// Objective. Saved as a single visit_notes row (SOAP-formatted body) tied
// to the current appointment, same table/shape the rest of the app already
// uses for visit notes (AppointmentsNotesPanel, VisitNotesTab).
//
// Redesign note: the My Day charting card only has room for a compact
// "Quick add" chip row (per the design spec) -- the full spine-segment +
// modifier + 60-code grid is real, valuable functionality that predates
// this redesign, so it's kept intact but tucked behind an "Advanced
// findings picker" disclosure instead of always taking up the whole card.
const props = defineProps<{ appointmentId: string; patientId: string }>()
const emit = defineEmits<{ saved: [] }>()

const supabase = useSupabaseClient()
const t = useT()

interface Segment { level: string; band: 'cervical' | 'thoracic' | 'lumbar' }
const SEGMENTS: Segment[] = [
  { level: 'OCC', band: 'cervical' },
  ...['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((level) => ({ level, band: 'cervical' as const })),
  ...['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'].map((level) => ({ level, band: 'thoracic' as const })),
  ...['L1', 'L2', 'L3', 'L4', 'L5'].map((level) => ({ level, band: 'lumbar' as const })),
]
const BAND_CLASS: Record<Segment['band'], string> = {
  cervical: 'bg-[#EAF6F6]',
  thoracic: 'bg-success-bg2',
  lumbar: 'bg-[#F5F0FB]',
}

const MODIFIERS = ['Left', 'Right', 'Pos', 'Ant', 'Sup', 'Inf'] as const
type Modifier = (typeof MODIFIERS)[number]

const CODE_GRID: string[][] = [
  ['P', 'PR', 'PL', 'PRI', 'PLI', 'PRS'],
  ['PLS', '+', '-', 'R', 'L', 'None'],
  ['CAT III', 'CAT II INSTABLE', 'CAT II STABLE', 'CAT I', 'CX MAJOR', 'PELVIS MAJOR'],
  ['TMJ PS', 'TMJ AI', 'CALF TENDERNESS', 'PLUMB LINE', 'AP', 'LAT'],
  ['HAND DOM', 'LEG DOM', 'EYE DOM', 'EAR DOM', 'ROM CX', 'ROM TX'],
  ['ROM LX', 'PI', 'AS', 'EX', 'IN', 'EXTENSION'],
  ['FLEXION', 'ROTATION', 'LAT FLEXION', '^', 'v', 'MORO REFLEX'],
  ['GALANT REFLEX', 'SUCKING REFLEX', 'BABINSKY', 'ATNR', 'STNR', 'TLR'],
  ['FEAR PARALYSIS', 'PALMAR GRASP', 'PEREZ REFLEX', 'ASR', 'AIR', 'ASL'],
  ['AIL', 'ASRP', 'ASRA', 'ASLP', 'ASLA', 'HYPERTROPIA'],
]

// A small, generic set of common chiropractic exam findings for one-click
// charting -- UI convenience text, not a clinical/coded reference list.
const QUICK_ADD_FINDINGS = [
  'Tenderness to palpation',
  'Muscle spasm',
  'Restricted ROM',
  'Positive orthopedic test',
  'Trigger point',
  'Antalgic gait',
  'Postural asymmetry',
  'Decreased strength',
]

const advancedOpen = ref(false)
const selectedSegment = ref<{ level: string; side: 'L' | 'R' } | null>(null)
const selectedModifier = ref<Modifier | null>(null)

function pickSegment(level: string, side: 'L' | 'R') {
  selectedSegment.value = selectedSegment.value?.level === level && selectedSegment.value?.side === side ? null : { level, side }
}
function toggleModifier(m: Modifier) {
  selectedModifier.value = selectedModifier.value === m ? null : m
}

const subjective = ref('')
const objective = ref('')
const action = ref('')
const plan = ref('')
const findings = ref<string[]>([])
const noteId = ref<string | null>(null)

function pickCode(code: string) {
  const parts = [selectedSegment.value ? `${selectedSegment.value.level}${selectedSegment.value.side}` : null, selectedModifier.value, code].filter(Boolean)
  const line = parts.join(' ')
  findings.value = [...findings.value, line]
  objective.value = objective.value ? `${objective.value}\n${line}` : line
  // Saved like typing is, a moment later rather than on the click: the chip's
  // text is usually edited straight away, and that edit is saved with it.
  touch()
}

function insertDatestamp() {
  const stamp = new Date().toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  objective.value = objective.value ? `${objective.value}\n${stamp}` : stamp
  touch()
}
function newLine() {
  objective.value += '\n'
  touch()
}
function undoLast() {
  if (findings.value.length === 0) return
  findings.value = findings.value.slice(0, -1)
  const lines = objective.value.split('\n')
  lines.pop()
  objective.value = lines.join('\n')
  touch()
}
function clearAll() {
  findings.value = []
  objective.value = ''
  touch()
}

function compileBody() {
  return [`Subjective: ${subjective.value}`, `Objective: ${objective.value}`, `Action: ${action.value}`, `Plan: ${plan.value}`].join('\n\n')
}
// The convention itself lives in utils/visitNote, so the pane that writes a
// note and every screen that reads one share a single definition of what a
// note is made of.
function parseBody(body: string) {
  const sections: Record<string, string> = {}
  for (const section of parseVisitNote(body).sections) sections[section.label] = section.text
  return sections
}

// Saved as it is typed (useVisitNoteAutosave): a moment after the last
// change, when the tab is hidden, and when the pane goes. These boxes used to
// be written only by "Save note", "Sign" or switching patient, so a note
// typed and then left in an open tab was lost with the tab.
//
// One row per visit: the first save inserts it, every later one updates it,
// one at a time. (Saves used to overlap: tabbing between boxes fired a second
// save while the first insert was in flight, noteId was still null, and it
// inserted a SECOND note -- five appointments in production ended up with
// duplicates, one with eight rows. The engine's queue is what prevents that.)
//
// 'saved' fires only when the note is first created: that is what flips the
// worklist's "Charted" stage, and later saves need no list reload.
//
// The visit being written: fixed per mount (My Day keys this pane by
// appointment), and moved only by the reset below.
let writingFor = props.appointmentId
const autosave = useVisitNoteAutosave({
  appointmentId: () => writingFor,
  noteId,
  body: compileBody,
  onSaved: (_row, created) => {
    if (created) emit('saved')
  },
})
const { state: saveState, errorKind: saveErrorKind } = autosave

// Typed before the note on this visit had loaded: saving then would insert a
// second note beside it, so the change waits for the load.
let touchedWhileLoading = false
function touch() {
  if (loadingNote.value) touchedWhileLoading = true
  else autosave.changed()
}

/** Writes the note now, typed in or not: "Sign" commits what is on screen. */
function save() {
  return autosave.saveNowForced()
}

// Pulls the patient's most recent note from a different appointment and
// prefills the SOAP fields with it, so a returning patient's chart can be
// copied forward and edited rather than typed from scratch.
async function copyLastNote() {
  const { data } = await supabase
    .from('visit_notes')
    .select('body, appointment_id, appointments!inner(patient_id)')
    .eq('appointments.patient_id', props.patientId)
    .neq('appointment_id', props.appointmentId)
    .order('created_at', { ascending: false })
    .limit(1)

  const last = data?.[0] as { body: string } | undefined
  if (!last) return
  const sections = parseBody(last.body)
  subjective.value = sections.Subjective ?? ''
  objective.value = sections.Objective ?? ''
  action.value = sections.Action ?? ''
  plan.value = sections.Plan ?? ''
  touch()
}

// Defense-in-depth alongside practitioner.vue's :key on the charting pane
// (which is what actually protects My Day today, by destroying and
// recreating this component per appointment switch): if this component is
// ever reused for a different appointment without being remounted, noteId
// must not carry over -- a stale noteId here is exactly what turned a save
// for one patient into an UPDATE against a different patient's note. See
// the account of that incident above doSave().
watch(
  () => props.appointmentId,
  () => {
    writingFor = props.appointmentId
    noteId.value = null
    autosave.reset()
    touchedWhileLoading = false
    subjective.value = ''
    objective.value = ''
    action.value = ''
    plan.value = ''
    findings.value = []
    selectedSegment.value = null
    selectedModifier.value = null
  },
)

// The visit's note as it stands, when there is one. Without this, reopening a
// visit charted earlier showed four empty boxes, and typing into them saved a
// SECOND note on the visit rather than editing the first.
const loadingNote = ref(true)
async function loadExisting() {
  loadingNote.value = true
  const id = props.appointmentId
  const { data } = await supabase.from('visit_notes').select('id, body').eq('appointment_id', id).order('created_at', { ascending: false }).limit(1)
  if (id !== props.appointmentId) return
  const row = (data as { id: string; body: string }[] | null)?.[0]
  if (row && !touchedWhileLoading && !autosave.unsaved()) {
    noteId.value = row.id
    const parsed = parseVisitNote(row.body)
    if (parsed.structured) {
      const sections = parseBody(row.body)
      subjective.value = [parsed.preamble, sections.Subjective ?? ''].filter(Boolean).join('\n\n')
      objective.value = sections.Objective ?? ''
      action.value = sections.Action ?? ''
      plan.value = sections.Plan ?? ''
    } else {
      // A free-text note (written elsewhere) is kept, as what was said.
      subjective.value = row.body.trim()
    }
  }
  loadingNote.value = false
  if (touchedWhileLoading) {
    touchedWhileLoading = false
    autosave.changed()
  }
}
onMounted(loadExisting)
watch(() => props.appointmentId, loadExisting)

// Changes made from outside the boxes -- the listing beside the note, "Bring
// over" from the last visit -- are saved the same way as typing.
function saveSoon() {
  touch()
}

/** The listing's "Ajustado: …" line, kept as Action's first line. */
function setListingLine(line: string) {
  const next = syncListingLine(action.value, line)
  if (next === action.value) return
  action.value = next
  saveSoon()
}
/** A section from the previous visit, added to today's (or the whole note into Subjective). */
function bringSection(section: 'Subjective' | 'Objective' | 'Action' | 'Plan' | 'Note', text: string) {
  const target = section === 'Note' ? subjective : section === 'Subjective' ? subjective : section === 'Objective' ? objective : section === 'Action' ? action : plan
  target.value = target.value.trim() ? `${target.value}\n${text}` : text
  saveSoon()
}

defineExpose({ save, copyLastNote, setListingLine, bringSection })

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()
</script>

<template>
  <div>
    <!-- Quick add -->
    <div class="border-b border-line-row px-5 py-3">
      <div class="flex items-center justify-between">
        <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Quick add', 'Añadir rápido') }}</p>
        <div class="flex items-center gap-2.5">
          <AppointmentsNoteSaveStatus :state="saveState" :error-kind="saveErrorKind" />
          <button
            type="button"
            class="rounded-ctlSm border border-line-control bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink-700 hover:border-line-controlHover disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="saveState === 'saving' || (saveState !== 'dirty' && saveState !== 'error')"
            @click="autosave.save()"
          >
            {{ t('Save note', 'Guardar nota') }}
          </button>
        </div>
      </div>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button
          v-for="chip in QUICK_ADD_FINDINGS"
          :key="chip"
          type="button"
          class="rounded-pill border border-chip-border bg-chip-bg px-2.5 py-1 text-[12px] font-medium text-chip-text hover:border-line-controlHover hover:bg-chip-bg2"
          @click="pickCode(chip)"
        >
          {{ chip }}
        </button>
      </div>
    </div>

    <!-- S/O/A/P grid -->
    <div class="grid grid-cols-1 gap-3 p-5">
      <div>
        <label :for="`${fieldId}-subjective`" class="mb-1 block text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Subjective', 'Subjetivo') }}</label>
        <textarea :id="`${fieldId}-subjective`"
          v-model="subjective"
          data-cy="soap-subjective"
          class="w-full min-h-[96px] rounded-[9px] border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @input="touch"
        ></textarea>
      </div>
      <div>
        <label :for="`${fieldId}-objective`" class="mb-1 block text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Objective', 'Objetivo') }}</label>
        <textarea :id="`${fieldId}-objective`"
          v-model="objective"
          data-cy="soap-objective"
          class="w-full min-h-[96px] rounded-[9px] border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @input="touch"
        ></textarea>
      </div>
      <div>
        <label :for="`${fieldId}-action`" class="mb-1 block text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Action', 'Acción') }}</label>
        <textarea :id="`${fieldId}-action`"
          v-model="action"
          data-cy="soap-action"
          class="w-full min-h-[76px] rounded-[9px] border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @input="touch"
        ></textarea>
      </div>
      <div>
        <label :for="`${fieldId}-plan`" class="mb-1 block text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Plan', 'Plan') }}</label>
        <textarea :id="`${fieldId}-plan`"
          v-model="plan"
          data-cy="soap-plan"
          class="w-full min-h-[76px] rounded-[9px] border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @input="touch"
        ></textarea>
      </div>
    </div>

    <!-- Advanced findings picker (spine segments, modifiers, code grid) -->
    <div class="border-t border-line-row">
      <button
        type="button"
        class="flex w-full items-center justify-between px-5 py-2.5 text-[12.5px] font-medium text-ink-muted2 hover:text-ink-600"
        @click="advancedOpen = !advancedOpen"
      >
        <span>{{ t('Advanced findings picker (spine segments & codes)', 'Selector avanzado de hallazgos (segmentos vertebrales y códigos)') }}</span>
        <svg width="9" height="9" viewBox="0 0 10 10" class="shrink-0 transition-transform" :class="{ 'rotate-180': advancedOpen }">
          <path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" />
        </svg>
      </button>

      <div v-if="advancedOpen" class="flex flex-col gap-4 border-t border-line-row p-3 lg:flex-row">
        <!-- Spine segment selector -->
        <div class="w-full shrink-0 overflow-y-auto lg:w-40" style="max-height: 420px">
          <div v-for="seg in SEGMENTS" :key="seg.level" class="mb-0.5 flex items-center gap-1 rounded-ctlSm px-1 py-0.5 text-[11px]" :class="BAND_CLASS[seg.band]">
            <button
              type="button"
              class="w-5 rounded-[5px] text-center font-medium"
              :class="selectedSegment?.level === seg.level && selectedSegment?.side === 'L' ? 'bg-brand text-brand-on' : 'text-ink-muted2 hover:bg-surface'"
              @click="pickSegment(seg.level, 'L')"
            >
              L
            </button>
            <span class="flex-1 text-center font-semibold text-ink-600">{{ seg.level }}</span>
            <button
              type="button"
              class="w-5 rounded-[5px] text-center font-medium"
              :class="selectedSegment?.level === seg.level && selectedSegment?.side === 'R' ? 'bg-brand text-brand-on' : 'text-ink-muted2 hover:bg-surface'"
              @click="pickSegment(seg.level, 'R')"
            >
              R
            </button>
          </div>
        </div>

        <!-- Utility + modifier + code grid -->
        <div class="min-w-0 flex-1">
          <p class="text-[11.5px] text-ink-muted2">
            {{ t('Selected:', 'Seleccionado:') }} <span class="font-medium text-ink-700">{{ selectedSegment ? `${selectedSegment.level}${selectedSegment.side}` : t('None', 'Ninguno') }}</span>
            <span v-if="selectedModifier"> &middot; {{ selectedModifier }}</span>
          </p>

          <div class="mt-2 grid grid-cols-4 gap-1 text-[11px]">
            <button type="button" class="rounded-ctlSm border border-line-control py-1.5 font-medium text-ink-500 hover:border-line-controlHover" @click="insertDatestamp">{{ t('Datestamp', 'Marca de fecha') }}</button>
            <button type="button" class="rounded-ctlSm border border-line-control py-1.5 font-medium text-ink-500 hover:border-line-controlHover" @click="clearAll">{{ t('Clear all', 'Borrar todo') }}</button>
            <button type="button" class="rounded-ctlSm border border-line-control py-1.5 font-medium text-ink-500 hover:border-line-controlHover" @click="newLine">{{ t('New line', 'Nueva línea') }}</button>
            <button type="button" class="rounded-ctlSm border border-line-control py-1.5 font-medium text-ink-500 hover:border-line-controlHover" @click="undoLast">{{ t('Undo last', 'Deshacer último') }}</button>
          </div>

          <div class="mt-1 grid grid-cols-6 gap-1 text-[11px]">
            <button
              v-for="m in MODIFIERS"
              :key="m"
              type="button"
              class="rounded-ctlSm py-1.5 font-medium"
              :class="selectedModifier === m ? 'bg-brand text-brand-on' : 'bg-ink-700 text-surface hover:bg-ink-600'"
              @click="toggleModifier(m)"
            >
              {{ m }}
            </button>
          </div>

          <div class="mt-2 grid grid-cols-6 gap-1 text-[11px] leading-tight">
            <button
              v-for="code in CODE_GRID.flat()"
              :key="code"
              type="button"
              class="rounded-ctlSm bg-brand-tint px-1 py-2 text-center font-medium text-brand-text2 hover:bg-brand-tintDeep"
              @click="pickCode(code)"
            >
              {{ code }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
