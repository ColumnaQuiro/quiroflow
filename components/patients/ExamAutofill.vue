<script setup lang="ts">
// First version of the chiropractic exam-finding grid, replicating the
// reference tool: pick a spine segment + side, an optional directional
// modifier, then a finding code -- each click appends one line to
// Objective. Saved as a single visit_notes row (SOAP-formatted body) tied
// to the current appointment, same table/shape the rest of the app already
// uses for visit notes (AppointmentsNotesPanel, VisitNotesTab).
const props = defineProps<{ appointmentId: string }>()
const emit = defineEmits<{ saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()

interface Segment { level: string; band: 'cervical' | 'thoracic' | 'lumbar' }
const SEGMENTS: Segment[] = [
  { level: 'OCC', band: 'cervical' },
  ...['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((level) => ({ level, band: 'cervical' as const })),
  ...['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'].map((level) => ({ level, band: 'thoracic' as const })),
  ...['L1', 'L2', 'L3', 'L4', 'L5'].map((level) => ({ level, band: 'lumbar' as const })),
]
const BAND_CLASS: Record<Segment['band'], string> = {
  cervical: 'bg-teal-50',
  thoracic: 'bg-green-50',
  lumbar: 'bg-purple-50',
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

async function save() {
  saving.value = true
  const body = compileBody()
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
  savedMessage.value = 'Saved'
  setTimeout(() => (savedMessage.value = ''), 2000)
}
async function saveDraft() {
  await save()
}
async function saveFinal() {
  await save()
  emit('saved')
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2">
      <p class="text-sm font-semibold text-gray-900">Exam Autofill</p>
      <div class="flex gap-2">
        <button type="button" :disabled="saving" class="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50" @click="saveDraft">
          Save Draft
        </button>
        <button type="button" :disabled="saving" class="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50" @click="saveFinal">
          Save Final
        </button>
        <span v-if="savedMessage" class="self-center text-xs text-green-600">{{ savedMessage }}</span>
      </div>
    </div>

    <div class="flex flex-col gap-4 p-3 lg:flex-row">
      <!-- Spine segment selector -->
      <div class="w-full shrink-0 overflow-y-auto lg:w-40" style="max-height: 420px">
        <div v-for="seg in SEGMENTS" :key="seg.level" class="mb-0.5 flex items-center gap-1 rounded px-1 py-0.5 text-xs" :class="BAND_CLASS[seg.band]">
          <button
            type="button"
            class="w-5 rounded text-center font-medium"
            :class="selectedSegment?.level === seg.level && selectedSegment?.side === 'L' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-white'"
            @click="pickSegment(seg.level, 'L')"
          >
            L
          </button>
          <span class="flex-1 text-center font-semibold text-gray-700">{{ seg.level }}</span>
          <button
            type="button"
            class="w-5 rounded text-center font-medium"
            :class="selectedSegment?.level === seg.level && selectedSegment?.side === 'R' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-white'"
            @click="pickSegment(seg.level, 'R')"
          >
            R
          </button>
        </div>
      </div>

      <!-- Utility + modifier + code grid -->
      <div class="min-w-0 flex-1">
        <p class="text-xs text-gray-500">
          Selected: <span class="font-medium text-gray-800">{{ selectedSegment ? `${selectedSegment.level}${selectedSegment.side}` : 'None' }}</span>
          <span v-if="selectedModifier"> &middot; {{ selectedModifier }}</span>
        </p>

        <div class="mt-2 grid grid-cols-4 gap-1 text-xs">
          <button type="button" class="rounded border border-gray-300 py-1.5 font-medium text-gray-700 hover:bg-gray-50" @click="insertDatestamp">Datestamp</button>
          <button type="button" class="rounded border border-gray-300 py-1.5 font-medium text-gray-700 hover:bg-gray-50" @click="clearAll">Clear All</button>
          <button type="button" class="rounded border border-gray-300 py-1.5 font-medium text-gray-700 hover:bg-gray-50" @click="newLine">New Line</button>
          <button type="button" class="rounded border border-gray-300 py-1.5 font-medium text-gray-700 hover:bg-gray-50" @click="undoLast">Undo Last</button>
        </div>

        <div class="mt-1 grid grid-cols-6 gap-1 text-xs">
          <button
            v-for="m in MODIFIERS"
            :key="m"
            type="button"
            class="rounded py-1.5 font-medium"
            :class="selectedModifier === m ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-white hover:bg-gray-700'"
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
            class="rounded bg-indigo-50 px-1 py-2 text-center font-medium text-indigo-900 hover:bg-indigo-100"
            @click="pickCode(code)"
          >
            {{ code }}
          </button>
        </div>
      </div>

      <!-- SOAP note -->
      <div class="w-full shrink-0 space-y-2 lg:w-72">
        <div>
          <label class="block text-xs font-medium text-gray-500">Subjective</label>
          <textarea v-model="subjective" rows="3" class="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"></textarea>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500">Objective</label>
          <textarea v-model="objective" rows="6" class="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"></textarea>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500">Action</label>
          <textarea v-model="action" rows="3" class="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"></textarea>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-500">Plan</label>
          <textarea v-model="plan" rows="3" class="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"></textarea>
        </div>
      </div>
    </div>
  </div>
</template>
