<script setup lang="ts">
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
const store = useAccountStore()
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
const saving = ref(false)
const savedMessage = ref('')

function pickCode(code: string) {
  const parts = [selectedSegment.value ? `${selectedSegment.value.level}${selectedSegment.value.side}` : null, selectedModifier.value, code].filter(Boolean)
  const line = parts.join(' ')
  findings.value = [...findings.value, line]
  objective.value = objective.value ? `${objective.value}\n${line}` : line
  // Quick-add chips and the advanced code grid both land here without ever
  // focusing the Objective textarea, so the blur-triggered autosave never
  // fires on its own -- save explicitly so a finding isn't lost if the
  // practitioner navigates away right after picking it.
  save()
}

function insertDatestamp() {
  const stamp = new Date().toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  objective.value = objective.value ? `${objective.value}\n${stamp}` : stamp
}
function newLine() {
  objective.value += '\n'
}
function undoLast() {
  if (findings.value.length === 0) return
  findings.value = findings.value.slice(0, -1)
  const lines = objective.value.split('\n')
  lines.pop()
  objective.value = lines.join('\n')
}
function clearAll() {
  findings.value = []
  objective.value = ''
}

function compileBody() {
  return [`Subjective: ${subjective.value}`, `Objective: ${objective.value}`, `Action: ${action.value}`, `Plan: ${plan.value}`].join('\n\n')
}
function parseBody(body: string) {
  const sections: Record<string, string> = {}
  for (const chunk of body.split('\n\n')) {
    const idx = chunk.indexOf(':')
    if (idx === -1) continue
    sections[chunk.slice(0, idx).trim()] = chunk.slice(idx + 1).trim()
  }
  return sections
}

// Persists the current SOAP fields. Runs on blur (autosave) and is exposed
// so the My Day header's "Sign & complete" button can force a final save.
// The 'saved' event only fires the first time a note is created for this
// appointment -- that's the transition that flips the worklist's "Charted"
// stage, so later autosaves don't need to trigger a list reload each time.
async function save() {
  saving.value = true
  const body = compileBody()
  const isFirstSave = !noteId.value
  if (noteId.value) {
    await supabase.from('visit_notes').update({ body }).eq('id', noteId.value)
  } else {
    const { data } = await supabase
      .from('visit_notes')
      .insert({ account_id: store.accountId!, appointment_id: props.appointmentId, body, created_by: store.teamMember?.id ?? null })
      .select('id')
      .single()
    noteId.value = data?.id ?? null
  }
  saving.value = false
  savedMessage.value = t('Saved', 'Guardado')
  setTimeout(() => (savedMessage.value = ''), 2000)
  if (isFirstSave && noteId.value) emit('saved')
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
}

defineExpose({ save, copyLastNote })
</script>

<template>
  <div>
    <!-- Quick add -->
    <div class="border-b border-line-row px-5 py-3">
      <div class="flex items-center justify-between">
        <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Quick add', 'Añadir rápido') }}</p>
        <span v-if="savedMessage" class="text-[11.5px] text-success-text">{{ savedMessage }}</span>
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
    <div class="grid grid-cols-2 gap-3 p-5">
      <div>
        <label class="mb-1 block text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Subjective', 'Subjetivo') }}</label>
        <textarea
          v-model="subjective"
          class="w-full min-h-[96px] rounded-[9px] border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @blur="save"
        ></textarea>
      </div>
      <div>
        <label class="mb-1 block text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Objective', 'Objetivo') }}</label>
        <textarea
          v-model="objective"
          class="w-full min-h-[96px] rounded-[9px] border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @blur="save"
        ></textarea>
      </div>
      <div>
        <label class="mb-1 block text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Action', 'Acción') }}</label>
        <textarea
          v-model="action"
          class="w-full min-h-[76px] rounded-[9px] border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @blur="save"
        ></textarea>
      </div>
      <div>
        <label class="mb-1 block text-[11px] font-[640] uppercase tracking-[.04em] text-ink-faint">{{ t('Plan', 'Plan') }}</label>
        <textarea
          v-model="plan"
          class="w-full min-h-[76px] rounded-[9px] border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @blur="save"
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
        <span>Advanced findings picker (spine segments &amp; codes)</span>
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
              :class="selectedSegment?.level === seg.level && selectedSegment?.side === 'L' ? 'bg-brand text-white' : 'text-ink-muted2 hover:bg-white'"
              @click="pickSegment(seg.level, 'L')"
            >
              L
            </button>
            <span class="flex-1 text-center font-semibold text-ink-600">{{ seg.level }}</span>
            <button
              type="button"
              class="w-5 rounded-[5px] text-center font-medium"
              :class="selectedSegment?.level === seg.level && selectedSegment?.side === 'R' ? 'bg-brand text-white' : 'text-ink-muted2 hover:bg-white'"
              @click="pickSegment(seg.level, 'R')"
            >
              R
            </button>
          </div>
        </div>

        <!-- Utility + modifier + code grid -->
        <div class="min-w-0 flex-1">
          <p class="text-[11.5px] text-ink-muted2">
            Selected: <span class="font-medium text-ink-700">{{ selectedSegment ? `${selectedSegment.level}${selectedSegment.side}` : 'None' }}</span>
            <span v-if="selectedModifier"> &middot; {{ selectedModifier }}</span>
          </p>

          <div class="mt-2 grid grid-cols-4 gap-1 text-[11px]">
            <button type="button" class="rounded-ctlSm border border-line-control py-1.5 font-medium text-ink-500 hover:border-line-controlHover" @click="insertDatestamp">Datestamp</button>
            <button type="button" class="rounded-ctlSm border border-line-control py-1.5 font-medium text-ink-500 hover:border-line-controlHover" @click="clearAll">Clear All</button>
            <button type="button" class="rounded-ctlSm border border-line-control py-1.5 font-medium text-ink-500 hover:border-line-controlHover" @click="newLine">New Line</button>
            <button type="button" class="rounded-ctlSm border border-line-control py-1.5 font-medium text-ink-500 hover:border-line-controlHover" @click="undoLast">Undo Last</button>
          </div>

          <div class="mt-1 grid grid-cols-6 gap-1 text-[11px]">
            <button
              v-for="m in MODIFIERS"
              :key="m"
              type="button"
              class="rounded-ctlSm py-1.5 font-medium"
              :class="selectedModifier === m ? 'bg-brand text-white' : 'bg-ink-700 text-white hover:bg-ink-600'"
              @click="toggleModifier(m)"
            >
              {{ m }}
            </button>
          </div>

          <div class="mt-2 grid grid-cols-6 gap-1 text-[10.5px] leading-tight">
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
