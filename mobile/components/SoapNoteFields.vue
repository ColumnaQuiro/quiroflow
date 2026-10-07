<script setup lang="ts">
// The visit note in four labelled sections -- Subjective, Objective, Action,
// Plan -- as the web's charting card writes it (components/patients/
// ExamAutofill.vue): one visit_notes body, "Subjective: …\n\nObjective: …",
// so a note charted here reads as sections on the web and back
// (utils/visitNote parses both). The labels are stored in English, as the
// web stores them, and shown in the reader's language.
//
// Under Objective, quick findings: a spine level and side, then a finding;
// each tap adds a line, which can be edited before it is saved.
import { parseVisitNote } from '../../utils/visitNote'

const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; input: []; blur: [] }>()
const t = useT()

type Key = 'Subjective' | 'Objective' | 'Action' | 'Plan'
const KEYS: Key[] = ['Subjective', 'Objective', 'Action', 'Plan']
const fields = reactive<Record<Key, string>>({ Subjective: '', Objective: '', Action: '', Plan: '' })
const LABELS = computed<Record<Key, string>>(() => ({
  Subjective: t('Subjective', 'Subjetivo'),
  Objective: t('Objective', 'Objetivo'),
  Action: t('Action', 'Actuación'),
  Plan: t('Plan', 'Plan'),
}))
const HINTS = computed<Record<Key, string>>(() => ({
  Subjective: t('What the patient says: pain, sleep, changes…', 'Lo que cuenta el paciente: dolor, sueño, cambios…'),
  Objective: t('What you find on examination', 'Lo que encuentras en la exploración'),
  Action: t('What you did today', 'Lo que has hecho hoy'),
  Plan: t('Next steps, exercises, next visit', 'Próximos pasos, ejercicios, próxima cita'),
}))

// The body as the web writes it. What was last emitted is remembered so an
// echo of our own value is not parsed back over what is being typed.
let lastEmitted: string | null = null
function compose() {
  return KEYS.map((k) => `${k}: ${fields[k].trim()}`).join('\n\n')
}
function fill(body: string) {
  const parsed = parseVisitNote(body)
  for (const k of KEYS) fields[k] = ''
  if (parsed.structured) {
    for (const s of parsed.sections) if (KEYS.includes(s.label as Key)) fields[s.label as Key] = s.text
    if (parsed.preamble) fields.Subjective = [parsed.preamble, fields.Subjective].filter(Boolean).join('\n\n')
  } else {
    // Free text written before switching: kept, as what the patient said.
    fields.Subjective = body.trim()
  }
}
watch(
  () => props.modelValue,
  (v) => {
    if (v === lastEmitted) return
    fill(v)
  },
  { immediate: true },
)
function changed() {
  const body = KEYS.every((k) => !fields[k].trim()) ? '' : compose()
  lastEmitted = body
  emit('update:modelValue', body)
  emit('input')
}

// -- Quick findings ---------------------------------------------------------------
const LEVELS = ['OCC', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'L1', 'L2', 'L3', 'L4', 'L5', 'S1', 'SI']
const level = ref('')
const side = ref<'L' | 'R' | ''>('')
const FINDINGS = computed(() => [
  t('Tenderness to palpation', 'Dolor a la palpación'),
  t('Muscle spasm', 'Espasmo muscular'),
  t('Restricted ROM', 'Movilidad restringida'),
  t('Trigger point', 'Punto gatillo'),
  t('Positive orthopedic test', 'Test ortopédico positivo'),
  t('Postural asymmetry', 'Asimetría postural'),
  t('Antalgic gait', 'Marcha antiálgica'),
  t('Decreased strength', 'Fuerza disminuida'),
  'P', 'PR', 'PL', 'PRI', 'PLI', 'PRS', 'PLS',
])
const findingsOpen = ref(false)
function addFinding(f: string) {
  const line = [level.value ? `${level.value}${side.value}` : null, f].filter(Boolean).join(' ')
  fields.Objective = fields.Objective.trim() ? `${fields.Objective.replace(/\s+$/, '')}\n${line}` : line
  changed()
}
function undoFinding() {
  const lines = fields.Objective.split('\n')
  lines.pop()
  fields.Objective = lines.join('\n')
  changed()
}
const area = 'block w-full resize-none rounded-[10px] border border-line-control bg-surface px-2.5 py-2 text-[15px] leading-[1.45] text-ink-900 placeholder:text-ink-faint focus:border-brand-tintBorder focus:outline-none focus:ring-[3px] focus:ring-brand-tint'
</script>

<template>
  <div class="flex flex-col gap-2.5" data-cy="soap-fields">
    <div v-for="k in KEYS" :key="k" class="flex flex-col gap-1">
      <span :id="`soap-label-${k}`" class="text-[11px] font-semibold uppercase tracking-[.04em] text-ink-muted">{{ LABELS[k] }}</span>
      <textarea v-model="fields[k]" :aria-labelledby="`soap-label-${k}`" :rows="k === 'Objective' ? 3 : 2" :placeholder="HINTS[k]" :readonly="disabled" :class="area" :data-cy="`soap-${k.toLowerCase()}`" @input="changed" @blur="emit('blur')" />
      <div v-if="k === 'Objective'" class="flex flex-col gap-1.5">
        <button type="button" class="self-start text-[12.5px] font-semibold text-brand-text" :aria-expanded="findingsOpen" data-cy="soap-findings-toggle" @click="findingsOpen = !findingsOpen">
          {{ findingsOpen ? t('Hide quick findings', 'Ocultar hallazgos rápidos') : t('+ Quick findings', '+ Hallazgos rápidos') }}
        </button>
        <div v-if="findingsOpen" class="flex flex-col gap-1.5 rounded-[10px] bg-surface-page p-2" data-cy="soap-findings">
          <div class="flex items-center gap-1.5">
            <select v-model="level" class="h-9 rounded-ctl border border-line-control bg-surface px-2 text-[14px] text-ink-900" :aria-label="t('Spine level', 'Nivel vertebral')" data-cy="soap-level">
              <option value="">{{ t('Level', 'Nivel') }}</option>
              <option v-for="l in LEVELS" :key="l" :value="l">{{ l }}</option>
            </select>
            <!-- L / R as written into the note, the codes the web charts with -->
            <button v-for="s in (['L', 'R'] as const)" :key="s" type="button" class="h-9 w-10 rounded-ctl border text-[13px] font-semibold" :class="side === s ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700'" :aria-pressed="side === s" :aria-label="s === 'L' ? t('Left', 'Izquierda') : t('Right', 'Derecha')" @click="side = side === s ? '' : s">
              {{ s }}
            </button>
            <button type="button" class="ml-auto h-9 px-2 text-[12.5px] font-medium text-ink-muted disabled:opacity-40" :disabled="!fields.Objective.trim()" @click="undoFinding">{{ t('Undo line', 'Deshacer línea') }}</button>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="f in FINDINGS" :key="f" type="button" class="min-h-9 rounded-full border border-line-control bg-surface px-2.5 text-[12.5px] text-ink-700 active:bg-brand-tint" data-cy="soap-finding" @click="addFinding(f)">{{ f }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
