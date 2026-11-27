<script setup lang="ts">
import Papa from 'papaparse'
import { exerciseImportDelimiter, exerciseImportTemplateCsv, planExerciseImport, type ExerciseImportPlan, type ExerciseImportProblem, type ExerciseImportRow } from '~/utils/exerciseImport'

// "Import CSV" on the exercise library (components/exercises/Library.vue):
// many exercises at once from a spreadsheet, usually one YouTube link each.
//
// Three steps in one dialog: pick a file (or download the template), look at
// what will be created -- every row that cannot be, and why, is shown and left
// out -- and a summary of what was created and skipped. Nothing is written
// before the second step's button.
//
// The rows are inserted exactly as the "New exercise" form inserts one, from
// the browser under the person's own session, so the library's RLS, the
// two-factor and read-only guards and the media_url check all apply as they
// would to a typed one.
const props = defineProps<{ accountId: string; teamMemberId: string | null; existingNames: string[] }>()
const emit = defineEmits<{ close: []; imported: [count: number] }>()
const t = useT()
const supabase = useSupabaseClient()

const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => close())

const stage = ref<'pick' | 'preview' | 'done'>('pick')
const fileName = ref('')
const fileError = ref('')
const dragOver = ref(false)
const plan = ref<ExerciseImportPlan | null>(null)
// Rows the person unticked in the preview: valid, but not wanted this time.
const leftOut = ref(new Set<number>())
const saving = ref(false)
const saveError = ref('')
const result = ref<{ created: number; skipped: number } | null>(null)

const rows = computed(() => plan.value?.rows ?? [])
const valid = computed(() => rows.value.filter((r) => !r.problem))
const chosen = computed(() => valid.value.filter((r) => !leftOut.value.has(r.line)))
const flagged = computed(() => rows.value.filter((r) => r.problem))

function problemLabel(p: ExerciseImportProblem) {
  switch (p) {
    case 'missing_name':
      return t('No name', 'Sin nombre')
    case 'bad_video':
      return t('Not a YouTube or Vimeo video', 'No es un vídeo de YouTube o Vimeo')
    case 'exists':
      return t('Already in the library', 'Ya está en la biblioteca')
    case 'repeated':
      return t('Repeated in the file', 'Repetido en el archivo')
  }
}

function downloadTemplate() {
  // The BOM makes Excel read the file as UTF-8, so accents typed into it
  // survive the round trip.
  const blob = new Blob(['\uFEFF' + exerciseImportTemplateCsv()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'plantilla-ejercicios.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function readCells(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    // Loaded only when someone picks a spreadsheet, not with the page.
    const { readSheet } = await import('read-excel-file/browser')
    const sheet = (await readSheet(file)) as unknown[][]
    return sheet.map((line) => line.map((v) => (v === null || v === undefined ? '' : String(v).trim())))
  }
  // file.text() decodes UTF-8 and drops a BOM; the replace is for the odd
  // file that carries two.
  const text = (await file.text()).replace(/^\uFEFF/, '')
  const parsed = Papa.parse<string[]>(text, { delimiter: exerciseImportDelimiter(text), skipEmptyLines: 'greedy' })
  const broken = parsed.errors.find((e) => e.type === 'Quotes')
  if (broken) throw new Error(t(`Unclosed quotes near line ${(broken.row ?? 0) + 1}.`, `Comillas sin cerrar cerca de la línea ${(broken.row ?? 0) + 1}.`))
  return parsed.data
}

async function handleFile(file: File) {
  fileError.value = ''
  fileName.value = file.name
  if (/\.xls$/i.test(file.name)) {
    fileError.value = t('Old .xls files cannot be read. Save it as .xlsx or CSV and try again.', 'Los archivos .xls antiguos no se pueden leer. Guárdalo como .xlsx o CSV y vuelve a intentarlo.')
    return
  }
  let cells: string[][]
  try {
    cells = await readCells(file)
  } catch (err) {
    fileError.value = t(`Could not read this file: ${(err as Error).message}`, `No se pudo leer este archivo: ${(err as Error).message}`)
    return
  }
  const next = planExerciseImport(cells, props.existingNames)
  if (next.noNameColumn) {
    fileError.value = t('No column is called "nombre". Use the template, or name the columns nombre, video_youtube and instrucciones.', 'Ninguna columna se llama «nombre». Usa la plantilla o nombra las columnas nombre, video_youtube e instrucciones.')
    return
  }
  if (next.rows.length === 0) {
    fileError.value = t('This file has no exercises, only the header row.', 'Este archivo no tiene ejercicios, solo la fila de títulos.')
    return
  }
  plan.value = next
  leftOut.value = new Set()
  stage.value = 'preview'
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}
function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) handleFile(file)
  // The same file again, after fixing it in Excel, still counts as a change.
  input.value = ''
}

function toggle(r: ExerciseImportRow) {
  const next = new Set(leftOut.value)
  if (next.has(r.line)) next.delete(r.line)
  else next.add(r.line)
  leftOut.value = next
}

function startOver() {
  stage.value = 'pick'
  plan.value = null
  fileName.value = ''
  saveError.value = ''
}

// In batches, so a library of several hundred is not one request PostgREST
// has to take whole; a batch that fails stops the import and says how many
// went in before it.
const BATCH = 100
async function importRows() {
  if (saving.value || chosen.value.length === 0) return
  saving.value = true
  saveError.value = ''
  const todo = chosen.value
  let created = 0
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH).map((r) => ({
      account_id: props.accountId,
      created_by: props.teamMemberId,
      name: r.name,
      instructions: r.instructions || null,
      media_url: r.mediaUrl,
    }))
    const { error } = await supabase.from('exercises').insert(batch as never)
    if (error) {
      saveError.value = error.message
      break
    }
    created += batch.length
  }
  saving.value = false
  if (created > 0) emit('imported', created)
  if (saveError.value && created === 0) return
  result.value = { created, skipped: rows.value.length - created }
  stage.value = 'done'
}

function close() {
  if (saving.value) return
  emit('close')
}

const th = 'px-3 py-2 text-left text-[12px] font-medium text-ink-muted'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-scrim/40 p-4 sm:items-center" @click.self="close">
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="h-exercise-import"
      data-cy="exercise-import"
      class="flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-popover"
    >
      <header class="flex shrink-0 items-center gap-3 border-b border-line py-3 pl-6 pr-3">
        <h2 id="h-exercise-import" class="min-w-0 flex-1 truncate text-[17px] font-bold text-ink-900">{{ t('Import exercises from a CSV', 'Importar ejercicios desde un CSV') }}</h2>
        <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700 touch:h-11 touch:w-11" :aria-label="t('Close', 'Cerrar')" data-cy="exercise-import-close" @click="close">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>

      <!-- 1. The file -->
      <div v-if="stage === 'pick'" class="flex flex-col gap-4 overflow-y-auto px-6 py-5">
        <p class="text-[13.5px] leading-snug text-ink-700">
          {{ t('One exercise per row. Columns:', 'Un ejercicio por fila. Columnas:') }}
        </p>
        <ul class="-mt-2 flex flex-col gap-1 text-[13px] text-ink-700">
          <li><code class="rounded-ctlSm bg-surface-subtle px-1.5 py-0.5 font-mono text-[12px]">nombre</code> — {{ t('required', 'obligatorio') }}</li>
          <li>
            <code class="rounded-ctlSm bg-surface-subtle px-1.5 py-0.5 font-mono text-[12px]">video_youtube</code> —
            {{ t('a YouTube link in any form (youtube.com/watch, youtu.be, Shorts) or Vimeo; optional', 'un enlace de YouTube en cualquier forma (youtube.com/watch, youtu.be, Shorts) o de Vimeo; opcional') }}
          </li>
          <li><code class="rounded-ctlSm bg-surface-subtle px-1.5 py-0.5 font-mono text-[12px]">instrucciones</code> — {{ t('how to do it; optional', 'cómo hacerlo; opcional') }}</li>
        </ul>
        <p class="text-[12.5px] text-ink-muted">
          {{ t('Separated by commas or semicolons, as Excel saves it. Sets and repetitions are chosen when assigning, not here.', 'Separadas por comas o punto y coma, como lo guarda Excel. Las series y repeticiones se eligen al asignar, no aquí.') }}
        </p>
        <div>
          <UiBtn data-cy="exercise-import-template" @click="downloadTemplate">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" /></svg>
            {{ t('Download the template', 'Descargar la plantilla') }}
          </UiBtn>
        </div>
        <label
          class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center"
          :class="dragOver ? 'border-brand bg-brand-tint' : 'border-line-control hover:bg-surface-subtle'"
          @dragover.prevent="dragOver = true"
          @dragleave.prevent="dragOver = false"
          @drop.prevent="onDrop"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="text-ink-faint" aria-hidden="true"><path d="M12 15V3m0 0-4 4m4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></svg>
          <span class="text-[14px] font-semibold text-ink-900">{{ t('Choose a CSV or Excel file', 'Elige un archivo CSV o Excel') }}</span>
          <span class="text-[12.5px] text-ink-muted">{{ t('or drop it here', 'o suéltalo aquí') }}</span>
          <input type="file" accept=".csv,.txt,.xlsx,text/csv" class="sr-only" data-cy="exercise-import-file" @change="onFileInput" />
        </label>
        <p v-if="fileError" role="alert" class="text-[13px] font-semibold text-danger-text" data-cy="exercise-import-file-error">{{ fileError }}</p>
      </div>

      <!-- 2. What will be created -->
      <template v-else-if="stage === 'preview'">
        <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-6 pb-2 pt-4 text-[13.5px]" data-cy="exercise-import-counts">
          <span class="truncate text-ink-muted">{{ fileName }}</span>
          <span class="font-semibold text-ink-900" data-cy="exercise-import-valid">{{ t(`${valid.length} ready to import`, `${valid.length} listos para importar`) }}</span>
          <span v-if="flagged.length" class="font-semibold text-warning-text" data-cy="exercise-import-flagged">{{ t(`${flagged.length} will be skipped`, `${flagged.length} se omitirán`) }}</span>
        </div>
        <div class="min-h-0 flex-1 overflow-auto border-y border-line">
          <table class="w-full border-collapse text-[13px]">
            <thead class="sticky top-0 bg-surface-subtle">
              <tr>
                <th :class="[th, 'w-10']"><span class="sr-only">{{ t('Import', 'Importar') }}</span></th>
                <th :class="[th, 'w-12']">{{ t('Row', 'Fila') }}</th>
                <th :class="th">{{ t('Name', 'Nombre') }}</th>
                <th :class="th">{{ t('Video', 'Vídeo') }}</th>
                <th :class="th">{{ t('Instructions', 'Instrucciones') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.line" class="border-t border-line-row align-top" :class="r.problem ? 'bg-warning-bg/40' : ''" data-cy="exercise-import-row" :data-problem="r.problem ?? undefined">
                <td class="px-3 py-2">
                  <input
                    v-if="!r.problem"
                    type="checkbox"
                    class="h-4 w-4 accent-brand"
                    :checked="!leftOut.has(r.line)"
                    :aria-label="t(`Import ${r.name}`, `Importar ${r.name}`)"
                    data-cy="exercise-import-row-check"
                    @change="toggle(r)"
                  />
                </td>
                <td class="px-3 py-2 font-mono text-[12px] text-ink-muted">{{ r.line }}</td>
                <td class="px-3 py-2">
                  <span class="block font-semibold text-ink-900" :class="r.name ? '' : 'italic text-ink-faint'">{{ r.name || t('(empty)', '(vacío)') }}</span>
                  <span v-if="r.problem" class="mt-0.5 block text-[12px] font-semibold text-warning-text" data-cy="exercise-import-row-problem">{{ problemLabel(r.problem) }}</span>
                </td>
                <td class="max-w-[220px] px-3 py-2">
                  <a v-if="r.mediaUrl" :href="r.mediaUrl" target="_blank" rel="noopener" class="block truncate text-brand-text hover:underline" :title="r.mediaUrl" data-cy="exercise-import-row-video">{{ r.mediaUrl.replace(/^https:\/\/(www\.)?/, '') }}</a>
                  <span v-else-if="r.video" class="block truncate text-danger-text" :title="r.video">{{ r.video }}</span>
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td class="max-w-[260px] px-3 py-2 text-ink-700"><span class="line-clamp-2">{{ r.instructions || '—' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="saveError" role="alert" class="px-6 pt-3 text-[13px] font-semibold text-danger-text" data-cy="exercise-import-error">{{ saveError }}</p>
        <footer class="flex shrink-0 flex-wrap items-center gap-2 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <UiBtn variant="primary" :disabled="saving || chosen.length === 0" data-cy="exercise-import-confirm" @click="importRows">
            {{ saving ? t('Importing…', 'Importando…') : chosen.length === 1 ? t('Import 1 exercise', 'Importar 1 ejercicio') : t(`Import ${chosen.length} exercises`, `Importar ${chosen.length} ejercicios`) }}
          </UiBtn>
          <UiBtn :disabled="saving" data-cy="exercise-import-restart" @click="startOver">{{ t('Choose another file', 'Elegir otro archivo') }}</UiBtn>
          <span v-if="flagged.length" class="text-[12.5px] text-ink-muted">{{ t('Rows with a problem are left out; fix them in the file and import it again.', 'Las filas con algún problema se omiten; corrígelas en el archivo y vuelve a importarlo.') }}</span>
        </footer>
      </template>

      <!-- 3. What happened -->
      <div v-else-if="result" class="flex flex-col gap-3 px-6 py-6" data-cy="exercise-import-result">
        <p class="text-[16px] font-bold text-ink-900" data-cy="exercise-import-created">
          {{ result.created === 1 ? t('1 exercise created', '1 ejercicio creado') : t(`${result.created} exercises created`, `${result.created} ejercicios creados`) }}
        </p>
        <p v-if="result.skipped > 0" class="text-[13.5px] text-ink-700" data-cy="exercise-import-skipped">
          {{ result.skipped === 1 ? t('1 row skipped.', '1 fila omitida.') : t(`${result.skipped} rows skipped.`, `${result.skipped} filas omitidas.`) }}
        </p>
        <p v-if="saveError" role="alert" class="text-[13px] font-semibold text-danger-text">{{ t(`The import stopped: ${saveError}`, `La importación se detuvo: ${saveError}`) }}</p>
        <ul v-if="flagged.length" class="max-h-[200px] divide-y divide-line-divider overflow-y-auto rounded-ctl border border-line text-[13px]">
          <li v-for="r in flagged" :key="r.line" class="flex gap-3 px-3 py-1.5">
            <span class="w-12 shrink-0 font-mono text-[12px] text-ink-muted">{{ t(`Row ${r.line}`, `Fila ${r.line}`) }}</span>
            <span class="min-w-0 flex-1 truncate text-ink-700">{{ r.name || t('(empty)', '(vacío)') }}</span>
            <span class="shrink-0 text-warning-text">{{ r.problem ? problemLabel(r.problem) : '' }}</span>
          </li>
        </ul>
        <div class="pt-2">
          <UiBtn variant="primary" data-cy="exercise-import-done" @click="close">{{ t('Done', 'Hecho') }}</UiBtn>
        </div>
      </div>
    </div>
  </div>
</template>
