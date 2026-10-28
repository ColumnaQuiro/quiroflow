<script setup lang="ts">
import { exerciseWeek } from '../../utils/exerciseWeek'
import { EXERCISE_CATALOG, EXERCISE_CATALOG_PROGRAMS, EXERCISE_CATALOG_REGIONS, exerciseCatalogItem } from '../../utils/exerciseCatalog'
import { normalizeSearchTerm } from '../../utils/searchText'

// "Ejercicios en casa" on a patient's record, in the web app and the staff
// app: what they have been given, how this week has gone (their ticks), and
// assigning more. The picker is a checklist: any number of exercises from
// the clinic's library and QuiroFlow's starter catalogue, a whole programme
// or body region with one tick, each chosen one with its own dose to adjust
// before they all go in one insert. A new exercise is written here too, and
// saved to the library for next time. Picking a catalogue exercise copies it
// into the library as it is assigned (useExerciseCatalog). What a patient
// has can also be saved as a programme, for the next patient like them.
const props = defineProps<{ accountId: string; patientId: string; teamMemberId: string | null }>()

const t = useT()
const { assigned, library, loading, loadError, saving, error, load, assign, assignProgram, end } = useStaffExercises({
  accountId: () => props.accountId,
  patientId: () => props.patientId,
  teamMemberId: () => props.teamMemberId,
})

const exercisePrograms = useExercisePrograms({ accountId: () => props.accountId })
const programs = exercisePrograms.programs
onMounted(exercisePrograms.load)

const open = ref(false)
const creating = ref(false)
const notice = ref('')
const name = ref('')
const instructions = ref('')
const mediaUrl = ref('')
const mediaPath = ref<string | null>(null)
const exerciseMedia = useExerciseMedia()
const sets = ref('')
const reps = ref('')
const frequency = ref('')
const notes = ref('')
const formError = ref('')
const query = ref('')
const catalog = useExerciseCatalog()
const copying = ref(false)

// Something that can be ticked: a library exercise ("lib:<id>") or a
// catalogue one the clinic has not copied yet ("catalog:<slug>"). A copied
// catalogue exercise is always its library row, so nothing is offered twice.
interface Entry {
  key: string
  name: string
  /** Its demonstration video, from the catalogue. */
  slug: string | null
  instructions: string | null
  sets: number | null
  reps: string | null
  frequency: string | null
  notes: string | null
  /** The patient already has it on. */
  had: boolean
}
// A ticked one, its dose as typed.
interface Chosen {
  key: string
  name: string
  sets: string
  reps: string
  frequency: string
  notes: string
}

const has = computed(() => new Set(assigned.value.map((a) => a.exercises?.id).filter(Boolean)))
const bySlug = computed(() => new Map(library.value.filter((e) => e.starter_key).map((e) => [e.starter_key!, e])))

function libraryEntry(ex: { id: string; name: string; instructions?: string | null; starter_key?: string | null }, d?: { sets: number | null; reps: string | null; frequency: string | null; notes?: string | null }): Entry {
  const item = exerciseCatalogItem(ex.starter_key)
  const usual = d ?? (item ? catalog.dose(item) : null)
  return {
    key: `lib:${ex.id}`,
    name: ex.name,
    slug: item?.slug ?? null,
    instructions: ex.instructions ?? null,
    sets: usual?.sets ?? null,
    reps: usual?.reps || null,
    frequency: usual?.frequency || null,
    notes: d?.notes ?? null,
    had: has.value.has(ex.id),
  }
}

function catalogEntry(slug: string): Entry | null {
  const copy = bySlug.value.get(slug)
  if (copy) return libraryEntry(copy)
  const item = exerciseCatalogItem(slug)
  if (!item) return null
  const d = catalog.dose(item)
  return { key: `catalog:${slug}`, name: t(item.name.en, item.name.es), slug, instructions: t(item.instructions.en, item.instructions.es), sets: d.sets, reps: d.reps || null, frequency: d.frequency || null, notes: null, had: false }
}

const matches = (text: string) => !query.value.trim() || normalizeSearchTerm(text).includes(normalizeSearchTerm(query.value.trim()))
const isEntry = (e: Entry | null): e is Entry => !!e

// Programmes are one tick each, found by their name; lists filter by exercise.
const clinicPrograms = computed(() =>
  programs.value
    .filter((p) => matches(p.name))
    .map((p) => ({
      key: `program:${p.id}`,
      name: p.name,
      entries: p.exercise_program_items.map((i) => libraryEntry({ id: i.exercise_id, name: i.exercises?.name ?? '', starter_key: library.value.find((e) => e.id === i.exercise_id)?.starter_key }, i)),
    })),
)
const catalogPrograms = computed(() =>
  EXERCISE_CATALOG_PROGRAMS.map((p) => ({ key: `catalog-program:${p.slug}`, name: t(p.name.en, p.name.es), entries: p.items.map(catalogEntry).filter(isEntry) })).filter((p) => matches(p.name)),
)
const lists = computed(() =>
  [
    { key: 'library', label: t('Your library', 'Tu biblioteca'), all: false, entries: library.value.map((e) => libraryEntry(e)) },
    ...EXERCISE_CATALOG_REGIONS.map((r) => ({
      key: `region:${r.key}`,
      label: `QuiroFlow · ${t(r.label.en, r.label.es)}`,
      all: true,
      // Copied ones are in the library list already.
      entries: EXERCISE_CATALOG.filter((e) => e.region === r.key && !bySlug.value.has(e.slug)).map((e) => catalogEntry(e.slug)).filter(isEntry),
    })),
  ]
    .map((l) => ({ ...l, entries: l.entries.filter((e) => matches(e.name)) }))
    .filter((l) => l.entries.length),
)

const chosen = ref<Chosen[]>([])
const isChosen = (key: string) => chosen.value.some((c) => c.key === key)
// The demonstration shown under the list: the last one ticked or previewed.
const preview = ref<Entry | null>(null)

function add(e: Entry) {
  if (e.had || isChosen(e.key)) return
  chosen.value.push({ key: e.key, name: e.name, sets: e.sets ? String(e.sets) : '', reps: e.reps ?? '', frequency: e.frequency ?? '', notes: e.notes ?? '' })
  if (e.slug) preview.value = e
}
function drop(key: string) {
  chosen.value = chosen.value.filter((c) => c.key !== key)
  if (preview.value?.key === key) preview.value = null
}
function toggle(e: Entry) {
  if (isChosen(e.key)) drop(e.key)
  else add(e)
}
/** Every one of a group the patient does not have yet is ticked. */
function allChosen(entries: Entry[]) {
  const free = entries.filter((e) => !e.had)
  return free.length > 0 && free.every((e) => isChosen(e.key))
}
function toggleGroup(entries: Entry[]) {
  if (allChosen(entries)) entries.forEach((e) => drop(e.key))
  else entries.forEach(add)
}

function reset(opts: { kept?: boolean } = {}) {
  // Cancelled (or the new exercise was not saved): nothing keeps the upload.
  if (!opts.kept && mediaPath.value) exerciseMedia.remove(mediaPath.value)
  mediaPath.value = null
  open.value = false
  creating.value = false
  chosen.value = []
  preview.value = null
  query.value = ''
  name.value = instructions.value = mediaUrl.value = sets.value = reps.value = frequency.value = notes.value = ''
  formError.value = ''
}

async function assignItems(items: { exercise_id: string; sets: number | null; reps: string | null; frequency: string | null; notes: string | null }[]) {
  const result = await assignProgram(items)
  if (!result) return
  if (result.skipped) {
    notice.value = result.added
      ? t(`Added ${result.added}; ${result.skipped} they already had.`, `Añadidos ${result.added}; ${result.skipped} ya los tenía.`)
      : t('They already have every exercise in it.', 'Ya tiene todos sus ejercicios.')
  }
  reset()
}

/** The library ids of catalogue exercises, copying any the clinic lacks; null if one failed. */
async function copyFromCatalog(slugs: string[]): Promise<string[] | null> {
  copying.value = true
  try {
    const ids: string[] = []
    for (const slug of slugs) {
      const id = await catalog.addToLibrary(props.accountId, slug, props.teamMemberId)
      if (!id) {
        formError.value = t("Couldn't add it to your library. Try again.", 'No se ha podido añadir a tu biblioteca. Inténtalo de nuevo.')
        return null
      }
      ids.push(id)
    }
    return ids
  } finally {
    copying.value = false
  }
}

async function save() {
  formError.value = ''
  notice.value = ''
  if (!creating.value) {
    await assignChosen()
    return
  }
  if (!name.value.trim()) {
    formError.value = t('Give the exercise a name.', 'Pon un nombre al ejercicio.')
    return
  }
  const link = mediaUrl.value.trim()
  if (link && !/^https?:\/\//i.test(link)) {
    formError.value = t('The link must start with https://', 'El enlace debe empezar por https://')
    return
  }
  const n = sets.value.trim() ? Number(sets.value) : null
  if (n !== null && (!Number.isInteger(n) || n < 1)) {
    formError.value = t('Sets must be a whole number.', 'Las series deben ser un número entero.')
    return
  }
  const ok = await assign({
    exerciseId: null,
    newExercise: { name: name.value, instructions: instructions.value.trim() || null, media_url: link || null, media_path: mediaPath.value },
    sets: n,
    reps: reps.value.trim() || null,
    frequency: frequency.value.trim() || null,
    notes: notes.value.trim() || null,
  })
  if (ok) reset({ kept: true })
}

/** Everything ticked, in one insert, copying catalogue ones into the library first. */
async function assignChosen() {
  if (!chosen.value.length) {
    formError.value = t('Choose at least one exercise.', 'Elige al menos un ejercicio.')
    return
  }
  const bad = chosen.value.find((c) => c.sets.trim() && !(Number.isInteger(Number(c.sets)) && Number(c.sets) >= 1))
  if (bad) {
    formError.value = t(`Sets must be a whole number (${bad.name}).`, `Las series deben ser un número entero (${bad.name}).`)
    return
  }
  const slugs = chosen.value.filter((c) => c.key.startsWith('catalog:')).map((c) => c.key.slice('catalog:'.length))
  const ids = await copyFromCatalog(slugs)
  if (!ids) return
  const copiedIds = new Map(slugs.map((s, i) => [s, ids[i]]))
  await assignItems(
    chosen.value.map((c) => ({
      exercise_id: c.key.startsWith('lib:') ? c.key.slice('lib:'.length) : copiedIds.get(c.key.slice('catalog:'.length))!,
      sets: c.sets.trim() ? Number(c.sets) : null,
      reps: c.reps.trim() || null,
      frequency: c.frequency.trim() || null,
      notes: c.notes.trim() || null,
    })),
  )
}

// "Save as programme": what this patient has now, with their doses.
const savingAs = ref(false)
const programName = ref('')
const programError = ref('')
async function saveAsProgram() {
  programError.value = ''
  if (!programName.value.trim()) {
    programError.value = t('Give the programme a name.', 'Pon un nombre al programa.')
    return
  }
  const items = assigned.value
    .filter((a) => a.exercises?.id)
    .map((a) => ({ exercise_id: a.exercises!.id, sets: a.sets, reps: a.reps, frequency: a.frequency, notes: a.notes }))
  const result = await exercisePrograms.save({ id: null, name: programName.value, description: null, items })
  if ('error' in result) {
    programError.value = t("Couldn't save it. Try again.", 'No se ha podido guardar. Inténtalo de nuevo.')
    return
  }
  notice.value = t(`Saved as “${programName.value.trim()}”.`, `Guardado como «${programName.value.trim()}».`)
  savingAs.value = false
  programName.value = ''
}

function dose(pe: { sets: number | null; reps: string | null; frequency: string | null }) {
  const sr = pe.sets && pe.reps ? `${pe.sets} × ${pe.reps}` : pe.sets ? t(`${pe.sets} sets`, `${pe.sets} series`) : pe.reps ?? ''
  return [sr, pe.frequency].filter(Boolean).join(' · ')
}

const input = 'h-10 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <section class="rounded-card border border-line bg-surface px-3.5 py-3 shadow-card" data-cy="staff-exercises">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Home exercises', 'Ejercicios en casa') }}</h2>
      <button v-if="!open" type="button" class="text-[12.5px] font-medium text-brand-text" data-cy="exercises-assign-open" @click="open = true">{{ t('+ Assign', '+ Asignar') }}</button>
    </div>

    <div v-if="loading" class="mt-2"><UiSkeleton class="h-4 w-40 rounded-ctlSm" /></div>
    <p v-else-if="loadError" class="mt-2 text-[12.5px] text-danger-text">
      {{ t("Couldn't load them.", 'No se han podido cargar.') }}
      <button type="button" class="ml-1 font-semibold text-brand-text" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>
    <ul v-else-if="assigned.length" class="mt-1.5 divide-y divide-line-row">
      <li v-for="pe in assigned" :key="pe.id" class="flex items-start gap-3 py-2.5" data-cy="exercise-row">
        <div class="min-w-0 flex-1">
          <p class="text-[14px] font-medium text-ink-900">{{ pe.exercises?.name }}</p>
          <p v-if="dose(pe)" class="text-[12.5px] text-ink-muted">{{ dose(pe) }}</p>
          <div class="mt-1.5 flex items-center gap-1" :aria-label="t('Last seven days', 'Últimos siete días')">
            <span v-for="d in exerciseWeek(pe.patient_exercise_logs.map((l) => l.done_on))" :key="d.date" class="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold" :class="d.done ? 'bg-success-accent text-white' : 'bg-chip-bg text-ink-faint'" :title="d.date">{{ d.initial }}</span>
            <span class="ml-1.5 text-[11.5px] text-ink-muted2" data-cy="exercise-adherence">{{ t(`${exerciseWeek(pe.patient_exercise_logs.map((l) => l.done_on)).filter((d) => d.done).length} of 7 days`, `${exerciseWeek(pe.patient_exercise_logs.map((l) => l.done_on)).filter((d) => d.done).length} de 7 días`) }}</span>
          </div>
        </div>
        <button type="button" class="shrink-0 text-[12px] font-medium text-ink-muted" :data-cy="`exercise-end-${pe.id}`" @click="end(pe.id)">{{ t('Remove', 'Quitar') }}</button>
      </li>
    </ul>
    <p v-else-if="!open" class="mt-1.5 text-[13px] text-ink-faint">{{ t('None assigned yet.', 'Aún no tiene ninguno.') }}</p>

    <p v-if="notice" class="mt-1.5 text-[12.5px] text-success-text" data-cy="exercises-notice">{{ notice }}</p>
    <div v-if="!loading && !open && assigned.length >= 2" class="mt-1">
      <button v-if="!savingAs" type="button" class="text-[12px] font-medium text-ink-muted hover:text-brand-text" data-cy="exercises-save-as-program" @click="savingAs = true; notice = ''">{{ t('Save these as a programme…', 'Guardar como programa…') }}</button>
      <form v-else class="mt-1.5 flex flex-wrap gap-2" @submit.prevent="saveAsProgram">
        <input v-model="programName" :class="[input, 'min-w-0 flex-1']" :placeholder="t('Programme name, e.g. Low back basics', 'Nombre, p. ej. Lumbalgia básica')" data-cy="exercises-program-name" />
        <UiBtn type="submit" variant="primary" data-cy="exercises-program-save">{{ t('Save', 'Guardar') }}</UiBtn>
        <UiBtn type="button" variant="secondary" @click="savingAs = false; programError = ''">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <p v-if="programError" role="alert" class="w-full text-[12.5px] text-danger-text">{{ programError }}</p>
      </form>
    </div>

    <form v-if="open" class="mt-3 space-y-2.5 border-t border-line-row pt-3" data-cy="exercises-assign-form" @submit.prevent="save">
      <template v-if="!creating">
        <input v-model="query" type="search" :class="input" :placeholder="t('Search exercises or programmes', 'Buscar ejercicios o programas')" data-cy="exercise-search" />
        <div class="max-h-[340px] overflow-y-auto rounded-ctl border border-line-control" data-cy="exercise-pick">
          <template v-for="section in [{ key: 'clinic', label: t('Your programmes', 'Tus programas'), items: clinicPrograms }, { key: 'catalog', label: t('QuiroFlow programmes', 'Programas de QuiroFlow'), items: catalogPrograms }]" :key="section.key">
            <template v-if="section.items.length">
              <p class="sticky top-0 z-[1] bg-surface-subtle px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ section.label }}</p>
              <label v-for="p in section.items" :key="p.key" class="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-surface-subtle" data-cy="exercise-group">
                <input type="checkbox" class="mt-0.5 rounded border-line-control text-brand-text focus:ring-brand" :checked="allChosen(p.entries)" :disabled="!p.entries.some((e) => !e.had)" @change="toggleGroup(p.entries)" />
                <span class="min-w-0 flex-1">
                  <span class="block text-[13.5px] font-medium text-ink-900">{{ p.name }} ({{ p.entries.length }})</span>
                  <span class="block truncate text-[12px] text-ink-muted">{{ p.entries.map((e) => e.name).join(' · ') }}</span>
                </span>
              </label>
            </template>
          </template>
          <template v-for="l in lists" :key="l.key">
            <p class="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-surface-subtle px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">
              {{ l.label }}
              <button v-if="l.all" type="button" class="text-[11.5px] font-medium normal-case tracking-normal text-brand-text" data-cy="exercise-group-all" @click="toggleGroup(l.entries)">
                {{ allChosen(l.entries) ? t('Untick all', 'Quitar todos') : t('Tick all', 'Marcar todos') }}
              </button>
            </p>
            <label v-for="e in l.entries" :key="e.key" class="flex items-center gap-2.5 px-3 py-2" :class="e.had ? 'opacity-60' : 'cursor-pointer hover:bg-surface-subtle'" data-cy="exercise-option">
              <input type="checkbox" class="rounded border-line-control text-brand-text focus:ring-brand" :checked="e.had || isChosen(e.key)" :disabled="e.had" @change="toggle(e)" />
              <span class="min-w-0 flex-1 text-[13.5px] text-ink-900">{{ e.name }}</span>
              <span v-if="e.had" class="shrink-0 text-[11.5px] text-ink-muted">{{ t('Already has it', 'Ya lo tiene') }}</span>
              <button v-else-if="e.slug" type="button" class="shrink-0 text-[11.5px] font-medium text-brand-text" :aria-label="t(`Watch ${e.name}`, `Ver ${e.name}`)" @click.prevent="preview = preview?.key === e.key ? null : e">▶</button>
            </label>
          </template>
          <p v-if="!clinicPrograms.length && !catalogPrograms.length && !lists.length" class="px-3 py-3 text-[13px] text-ink-faint">{{ t('Nothing matches.', 'No hay coincidencias.') }}</p>
        </div>
        <button type="button" class="text-[12.5px] font-medium text-brand-text" data-cy="exercise-new" @click="creating = true; formError = ''">{{ t('+ New exercise', '+ Ejercicio nuevo') }}</button>

        <div v-if="preview?.slug" class="max-w-[360px]" data-cy="exercise-pick-preview">
          <ExercisesCatalogVideo :key="preview.slug" :slug="preview.slug" :label="preview.name" />
          <p v-if="preview.instructions" class="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-muted">{{ preview.instructions }}</p>
        </div>

        <div v-if="chosen.length" class="space-y-1.5" data-cy="exercise-chosen-list">
          <p class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t(`Chosen (${chosen.length})`, `Elegidos (${chosen.length})`) }}</p>
          <div v-for="c in chosen" :key="c.key" class="rounded-ctl bg-surface-subtle px-3 py-2" data-cy="exercise-chosen">
            <div class="flex items-center justify-between gap-2">
              <span class="min-w-0 text-[13.5px] font-medium text-ink-900">{{ c.name }}</span>
              <button type="button" class="shrink-0 text-[12px] font-medium text-ink-muted" data-cy="exercise-chosen-remove" @click="drop(c.key)">{{ t('Remove', 'Quitar') }}</button>
            </div>
            <div class="mt-1.5 grid grid-cols-[4.5rem_1fr_1fr] gap-2">
              <input v-model="c.sets" inputmode="numeric" :class="input" :placeholder="t('Sets', 'Series')" :aria-label="t('Sets', 'Series')" data-cy="exercise-sets" />
              <input v-model="c.reps" :class="input" :placeholder="t('Reps or time', 'Reps o tiempo')" :aria-label="t('Reps or time', 'Reps o tiempo')" data-cy="exercise-reps" />
              <input v-model="c.frequency" :class="input" :placeholder="t('How often', 'Frecuencia')" :aria-label="t('How often', 'Frecuencia')" data-cy="exercise-frequency" />
            </div>
            <input v-if="chosen.length === 1" v-model="c.notes" :class="[input, 'mt-2']" :placeholder="t('Note for the patient (optional)', 'Nota para el paciente (opcional)')" data-cy="exercise-notes" />
          </div>
        </div>
      </template>

      <template v-else>
        <button type="button" class="text-[12.5px] font-medium text-ink-muted hover:text-brand-text" data-cy="exercise-back" @click="creating = false; formError = ''">{{ t('← Back to the list', '← Volver a la lista') }}</button>
        <input v-model="name" :class="input" :placeholder="t('Name, e.g. Cat-camel', 'Nombre, p. ej. Gato-camello')" data-cy="exercise-name" />
        <textarea v-model="instructions" rows="2" :class="[input, 'h-auto py-2']" :placeholder="t('How to do it (optional)', 'Cómo hacerlo (opcional)')" />
        <input v-model="mediaUrl" type="url" inputmode="url" :class="input" :placeholder="t('Video or image link (optional)', 'Enlace a vídeo o imagen (opcional)')" data-cy="exercise-link" />
        <ExercisesMediaField v-model="mediaPath" :account-id="accountId" />
        <div class="grid grid-cols-3 gap-2">
          <input v-model="sets" inputmode="numeric" :class="input" :placeholder="t('Sets', 'Series')" data-cy="exercise-sets" />
          <input v-model="reps" :class="input" :placeholder="t('Reps or time', 'Reps o tiempo')" data-cy="exercise-reps" />
          <input v-model="frequency" :class="input" :placeholder="t('How often', 'Frecuencia')" data-cy="exercise-frequency" />
        </div>
        <input v-model="notes" :class="input" :placeholder="t('Note for the patient (optional)', 'Nota para el paciente (opcional)')" data-cy="exercise-notes" />
      </template>

      <p v-if="formError || error" role="alert" class="text-[12.5px] text-danger-text">{{ formError || error }}</p>
      <div class="flex gap-2">
        <UiBtn type="submit" variant="primary" :disabled="saving || copying || (!creating && !chosen.length)" data-cy="exercise-save">
          {{ saving || copying ? t('Saving…', 'Guardando…') : !creating && chosen.length ? t(`Assign ${chosen.length}`, `Asignar ${chosen.length}`) : t('Assign', 'Asignar') }}
        </UiBtn>
        <UiBtn type="button" variant="secondary" @click="reset()">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </form>
  </section>
</template>
