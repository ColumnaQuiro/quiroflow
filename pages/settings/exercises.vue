<script setup lang="ts">
import { readSteps } from '~/utils/exerciseSchedule'
// The clinic's library of home exercises: what a practitioner picks from
// when assigning one on a patient's record (components/exercises/Staff.vue),
// which is also where most of them are first created.
//
// Editing one changes it for every patient who has it -- the assignment
// points at the library row, it does not copy it -- which is usually what is
// wanted (a better video, a clearer instruction) and is said on the page.
//
// patient_exercises.exercise_id is ON DELETE CASCADE, so deleting an exercise
// anyone has ever been given would take their assignment and its ticked days
// with it. Delete is therefore offered only for one never assigned and in no
// programme (exercise_program_items cascades the same way); anything else is
// archived: off the picker, still on the patients who have it.
//
// QuiroFlow's starter catalogue sits below (ExercisesCatalog): adding from it
// makes an ordinary row here, marked with starter_key, whose demonstration
// video plays wherever the exercise does unless the clinic uploads its own.
//
// The counts are read under the viewer's own RLS, so a role limited to its
// own patients counts only those; this page is for clinic_config roles,
// which in practice see all of them.

interface LibraryExercise {
  id: string
  name: string
  instructions: string | null
  media_url: string | null
  media_path: string | null
  starter_key: string | null
  archived_at: string | null
  current: { count: number }[]
  ever: { count: number }[]
  in_programs: { count: number }[]
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()
const media = useExerciseMedia()
const catalog = useExerciseCatalog()
const catalogSection = ref<{ reload: () => Promise<void> } | null>(null)

const exercises = ref<LibraryExercise[]>([])
const loading = ref(true)

async function load() {
  // Two embedded counts of the same relation: patients doing it now (not
  // ended) and ever, which is what decides whether delete is safe.
  // The relationship is named because patient_exercises has more than one
  // foreign key now (patient_schedule_id too).
  const { data, error } = await supabase
    .from('exercises')
    .select('id, name, instructions, media_url, media_path, starter_key, archived_at, current:patient_exercises!patient_exercises_exercise_id_fkey(count), ever:patient_exercises!patient_exercises_exercise_id_fkey(count), in_programs:exercise_program_items(count)')
    .is('current.ended_at', null)
    .order('name')
  if (error) showToast(error.message, 'error')
  exercises.value = (data as unknown as LibraryExercise[] | null) ?? []
  loading.value = false
  // A renamed or archived exercise shows in the programmes and schedules too.
  programsSection.value?.reload()
  schedulesSection.value?.reload()
  loadScheduled()
  catalogSection.value?.reload()
}
onMounted(load)

const nowCount = (e: LibraryExercise) => e.current?.[0]?.count ?? 0
const everCount = (e: LibraryExercise) => e.ever?.[0]?.count ?? 0
// Schedules hold exercises by id inside their steps, which no foreign key
// sees: one a template or a patient's schedule still names is archived
// rather than deleted, so the step does not silently lose it.
const inSchedules = ref(new Set<string>())
async function loadScheduled() {
  const [{ data: templates }, { data: patients }] = await Promise.all([
    supabase.from('exercise_schedules').select('steps'),
    supabase.from('patient_exercise_schedules').select('steps').is('ended_at', null),
  ])
  inSchedules.value = new Set(
    [...((templates as { steps: unknown }[] | null) ?? []), ...((patients as { steps: unknown }[] | null) ?? [])].flatMap((r) => readSteps(r.steps).flatMap((st) => st.items.map((i) => i.exercise_id))),
  )
}
const deletable = (e: LibraryExercise) => everCount(e) === 0 && (e.in_programs?.[0]?.count ?? 0) === 0 && !inSchedules.value.has(e.id)
const programsSection = ref<{ reload: () => Promise<void>; count: number } | null>(null)
const schedulesSection = ref<{ reload: () => Promise<void>; count: number } | null>(null)
const active = computed(() => exercises.value.filter((e) => !e.archived_at))
const archived = computed(() => exercises.value.filter((e) => e.archived_at))

function countLabel(e: LibraryExercise) {
  const n = nowCount(e)
  if (n === 0) return everCount(e) === 0 ? t('Never assigned', 'Nunca asignado') : t('Nobody now', 'Nadie ahora')
  return n === 1 ? t('1 patient', '1 paciente') : t(`${n} patients`, `${n} pacientes`)
}

// --- tabs ---
//
// One section at a time. Stacked, every exercise added pushed programmes,
// schedules, the catalogue and the archive further down the page, and a
// clinic with a real library had to scroll past all of it to reach them.
// The sections stay mounted (v-show), so each tab's count is known and their
// reloads after a rename or an archive keep working; the tab is in the URL
// so a refresh or a shared link lands on it.
const TABS = ['exercises', 'programs', 'schedules', 'catalog', 'archived'] as const
type Tab = (typeof TABS)[number]
const route = useRoute()
const router = useRouter()
const tab = computed<Tab>({
  get: () => (TABS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'exercises'),
  set: (v) => router.replace({ query: { ...route.query, tab: v === 'exercises' ? undefined : v } }),
})
const tabs = computed(() => [
  { key: 'exercises' as const, label: t('Exercises', 'Ejercicios'), count: loading.value ? null : active.value.length },
  { key: 'programs' as const, label: t('Programmes', 'Programas'), count: programsSection.value?.count ?? null },
  { key: 'schedules' as const, label: t('Schedules', 'Pautas'), count: schedulesSection.value?.count ?? null },
  { key: 'catalog' as const, label: t('QuiroFlow catalogue', 'Catálogo QuiroFlow'), count: null },
  { key: 'archived' as const, label: t('Archived', 'Archivados'), count: loading.value ? null : archived.value.length },
])
// Arrow keys move between tabs, as a tablist does.
function onTabKey(e: KeyboardEvent) {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const next = TABS[(TABS.indexOf(tab.value) + step + TABS.length) % TABS.length]
  tab.value = next
  nextTick(() => document.getElementById(`exercises-tab-${next}`)?.focus())
}

// --- finding one in a long library ---

const query = ref('')
const filter = ref<'all' | 'now' | 'never'>('all')
const filters = computed(() => [
  { key: 'all' as const, label: t('All', 'Todos'), count: active.value.length },
  { key: 'now' as const, label: t('In use', 'En uso'), count: active.value.filter((e) => nowCount(e) > 0).length },
  { key: 'never' as const, label: t('Never assigned', 'Sin asignar'), count: active.value.filter((e) => everCount(e) === 0).length },
])
// Accent-blind, over the name and the instructions: "rotacion" finds
// "Rotación torácica", "rodilla" finds one whose instructions mention it.
const shown = computed(() => {
  const q = normalizeSearchTerm(query.value.trim())
  return active.value.filter((e) => {
    if (filter.value === 'now' && nowCount(e) === 0) return false
    if (filter.value === 'never' && everCount(e) > 0) return false
    return !q || normalizeSearchTerm(`${e.name} ${e.instructions ?? ''}`).includes(q)
  })
})
function clearSearch() {
  query.value = ''
  filter.value = 'all'
}

// --- adding and editing (one form, for a new one or the one being edited) ---

const editingId = ref<string | null>(null)
const adding = ref(false)
const form = reactive({ name: '', instructions: '', media_url: '', media_path: null as string | null })
// What the exercise had when the form opened: an upload that replaced it is
// the one to keep on save, and the one to throw away on cancel.
const savedPath = ref<string | null>(null)
const saving = ref(false)
const formError = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const editingRow = computed(() => exercises.value.find((e) => e.id === editingId.value) ?? null)
const editingCatalog = computed(() => !!editingRow.value?.starter_key)

// The form is a panel over the page's right edge rather than a card above
// the list, so the list stays where it was -- the row that opened it may be
// a long way down -- and focus goes back to that row's button on close.
const panelOpen = computed(() => adding.value || !!editingId.value)
let opener: HTMLElement | null = null
// What the form held when it opened: a click on the backdrop closes it only
// while nothing has been typed, so a stray click loses no work. Escape and
// Cancel are deliberate and close it either way.
const pristine = ref('')
const dirty = computed(() => JSON.stringify(form) !== pristine.value)
function focusForm() {
  pristine.value = JSON.stringify(form)
  nextTick(() => nameInput.value?.focus())
}
function rememberOpener() {
  if (!panelOpen.value) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
}
function onBackdrop() {
  if (!dirty.value) closeForm()
}
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  // Something opened from the panel that answers Escape itself (the media
  // field's viewer) calls preventDefault; look once the event is done.
  setTimeout(() => {
    if (!e.defaultPrevented && panelOpen.value) closeForm()
  })
}
watch(panelOpen, (open) => (open ? document.addEventListener('keydown', onKeydown) : document.removeEventListener('keydown', onKeydown)))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

function reachLabel(e: LibraryExercise) {
  const n = nowCount(e)
  if (n === 0) return ''
  return n === 1
    ? t('1 patient is doing it now; the change reaches them too.', 'Lo tiene 1 paciente ahora; el cambio también le llega.')
    : t(`${n} patients are doing it now; the change reaches all of them.`, `Lo tienen ${n} pacientes ahora; el cambio les llega a todos.`)
}

function openNew() {
  rememberOpener()
  editingId.value = null
  adding.value = true
  Object.assign(form, { name: '', instructions: '', media_url: '', media_path: null })
  savedPath.value = null
  formError.value = ''
  focusForm()
}
function openEdit(e: LibraryExercise) {
  rememberOpener()
  adding.value = false
  editingId.value = e.id
  Object.assign(form, { name: e.name, instructions: e.instructions ?? '', media_url: e.media_url ?? '', media_path: e.media_path })
  savedPath.value = e.media_path
  formError.value = ''
  focusForm()
}
function closeForm() {
  // Cancelled: an upload made in this form is not kept by anything.
  if (form.media_path && form.media_path !== savedPath.value) media.remove(form.media_path)
  form.media_path = savedPath.value
  adding.value = false
  editingId.value = null
  const back = opener
  opener = null
  nextTick(() => {
    if (back?.isConnected) back.focus({ preventScroll: true })
  })
}

async function save() {
  formError.value = ''
  const name = form.name.trim()
  if (!name) {
    formError.value = t('Give it a name.', 'Ponle un nombre.')
    return
  }
  const link = form.media_url.trim()
  if (link && !/^https?:\/\//i.test(link)) {
    formError.value = t('The link has to start with https://', 'El enlace tiene que empezar por https://')
    return
  }
  if (exercises.value.some((e) => e.id !== editingId.value && !e.archived_at && e.name.trim().toLowerCase() === name.toLowerCase())) {
    formError.value = t('There is already an exercise with that name.', 'Ya hay un ejercicio con ese nombre.')
    return
  }
  const values = { name, instructions: form.instructions.trim() || null, media_url: link || null, media_path: form.media_path }
  saving.value = true
  const { error } = editingId.value
    ? await supabase.from('exercises').update(values as never).eq('id', editingId.value)
    : await supabase.from('exercises').insert({ ...values, account_id: store.accountId!, created_by: store.teamMember?.id ?? null } as never)
  saving.value = false
  if (error) {
    formError.value = error.message
    return
  }
  // Saved: the file it replaced (or that was removed) belongs to nothing now.
  if (savedPath.value && savedPath.value !== form.media_path) await media.remove(savedPath.value)
  savedPath.value = form.media_path
  closeForm()
  await load()
}

async function setArchived(e: LibraryExercise, archive: boolean) {
  const { error } = await supabase
    .from('exercises')
    .update({ archived_at: archive ? new Date().toISOString() : null } as never)
    .eq('id', e.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  if (editingId.value === e.id) closeForm()
  await load()
}

async function remove(e: LibraryExercise) {
  const { error } = await supabase.from('exercises').delete().eq('id', e.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  media.remove(e.media_path)
  await load()
}

const inputClass = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Exercise Library', 'Biblioteca de ejercicios')">
      <UiBtn variant="primary" data-cy="library-new" @click="openNew">{{ t('New exercise', 'Nuevo ejercicio') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="settings-list" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{
              t(
                "The home exercises practitioners pick from on a patient's record. A change here reaches every patient who has the exercise, in the app and the portal.",
                'Los ejercicios para casa que se eligen en la ficha del paciente. Un cambio aquí llega a todos los pacientes que lo tienen, en la app y en el portal.',
              )
            }}
          </p>

          <div role="tablist" :aria-label="t('Exercise library sections', 'Secciones de la biblioteca')" class="-mb-1 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" @keydown="onTabKey">
            <button
              v-for="tb in tabs"
              :id="`exercises-tab-${tb.key}`"
              :key="tb.key"
              type="button"
              role="tab"
              :aria-selected="tab === tb.key"
              :aria-controls="`exercises-panel-${tb.key}`"
              :tabindex="tab === tb.key ? 0 : -1"
              :data-cy="`exercises-tab-${tb.key}`"
              class="-mb-px flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[14px] font-semibold"
              :class="tab === tb.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700'"
              @click="tab = tb.key"
            >
              {{ tb.label }}
              <span v-if="tb.count !== null" class="rounded-pill bg-chip-bg px-1.5 py-px text-[11.5px] font-semibold text-chip-text">{{ tb.count }}</span>
            </button>
          </div>

          <!-- Exercises -->
          <section v-show="tab === 'exercises'" id="exercises-panel-exercises" role="tabpanel" aria-labelledby="exercises-tab-exercises" class="overflow-hidden rounded-card border border-line bg-surface">
            <div v-if="!loading && active.length > 0" class="flex flex-wrap items-center gap-2 px-[18px] py-3">
              <label class="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-ctl border border-line-control bg-surface px-3 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand touch:h-11">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="shrink-0 text-ink-faint" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input
                  v-model="query"
                  type="search"
                  :placeholder="t(`Search ${active.length} exercises`, `Buscar en ${active.length} ejercicios`)"
                  :aria-label="t('Search exercises', 'Buscar ejercicios')"
                  class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] text-ink-900 outline-none placeholder:text-ink-faint focus:ring-0"
                  data-cy="library-search"
                />
              </label>
              <div class="flex gap-1.5" role="group" :aria-label="t('Show', 'Mostrar')">
                <button
                  v-for="f in filters"
                  :key="f.key"
                  type="button"
                  :aria-pressed="filter === f.key"
                  :data-cy="`library-filter-${f.key}`"
                  class="flex h-9 items-center gap-1.5 rounded-ctl border px-2.5 text-[13px] font-medium touch:h-11"
                  :class="filter === f.key ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
                  @click="filter = f.key"
                >
                  {{ f.label }}<span class="text-[12px] opacity-80">{{ f.count }}</span>
                </button>
              </div>
            </div>
            <div v-if="!loading && shown.length > 0" class="hidden items-center gap-3 border-t border-line-row py-1.5 pl-[18px] pr-3 text-[12px] font-medium text-ink-muted sm:flex" aria-hidden="true">
              <span class="flex-1">{{ t('Name', 'Nombre') }}</span>
              <span class="w-[110px] text-right">{{ t('Doing it now', 'Haciéndolo ahora') }}</span>
              <span class="w-[72px] touch:w-[88px]" />
              <span class="w-[72px] touch:w-[88px]" />
            </div>

            <template v-if="loading">
              <div v-for="i in 4" :key="i" class="flex items-center gap-4 border-t border-line-row px-[18px] py-4 first:border-t-0">
                <UiSkeleton class="h-4 w-40 rounded-ctlSm" />
                <UiSkeleton class="h-3 flex-1 rounded-ctlSm" />
              </div>
            </template>
            <div v-else-if="active.length === 0" class="flex flex-col items-center gap-3 px-[18px] py-8 text-center">
              <p class="max-w-[440px] text-[14px] text-ink-muted">
                {{ t("No exercises yet. Add some from the QuiroFlow catalogue, write your own, or assign one on a patient's record.", 'Aún no hay ejercicios. Añade algunos del catálogo de QuiroFlow, escribe los tuyos o asigna uno en la ficha de un paciente.') }}
              </p>
              <UiBtn data-cy="library-open-catalog" @click="tab = 'catalog'">{{ t('Open the catalogue', 'Abrir el catálogo') }}</UiBtn>
            </div>
            <div v-else-if="shown.length === 0" class="flex flex-col items-center gap-3 border-t border-line-row px-[18px] py-8 text-center" data-cy="library-no-match">
              <p class="text-[14px] text-ink-muted">{{ query.trim() ? t(`No exercise matches “${query.trim()}”.`, `Ningún ejercicio coincide con «${query.trim()}».`) : t('No exercise is in this group.', 'Ningún ejercicio está en este grupo.') }}</p>
              <UiBtn @click="clearSearch">{{ t('Show all', 'Ver todos') }}</UiBtn>
            </div>

            <div v-for="e in shown" :key="e.id" data-cy="library-row" class="flex min-h-[56px] items-center gap-3 border-t border-line-row py-2 pl-[18px] pr-3">
              <div class="flex min-w-0 flex-1 flex-col">
                <strong class="truncate text-[14.5px] text-ink-900" data-cy="library-row-name">{{ e.name }}</strong>
                <span v-if="e.instructions" class="truncate text-[13px] text-ink-muted">{{ e.instructions }}</span>
                <span class="text-[12.5px] text-ink-500 sm:hidden">{{ countLabel(e) }}</span>
              </div>
              <span class="hidden w-[110px] shrink-0 text-right text-[13.5px] text-ink-500 sm:block" data-cy="library-row-count">{{ countLabel(e) }}</span>
              <!-- What the patient sees with it: two fixed slots from sm up, so the counts line up down the list; on a phone an empty one takes no room from the instructions. -->
              <div class="flex shrink-0 justify-end sm:w-[72px] sm:touch:w-[88px]">
                <button v-if="e.media_path" type="button" :class="[iconBtn, 'text-brand-text']" :title="exerciseMediaKind(e.media_path) === 'video' ? t('Play the video', 'Ver el vídeo') : t('See the photo', 'Ver la foto')" data-cy="library-row-media" @click="openWhenReady(() => media.signedUrl(e.media_path!))">
                  <svg v-if="exerciseMediaKind(e.media_path) === 'video'" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>
                  <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
                  <span class="sr-only">{{ exerciseMediaKind(e.media_path) === 'video' ? t('Video', 'Vídeo') : t('Photo', 'Foto') }}</span>
                </button>
                <button v-else-if="e.starter_key" type="button" :class="[iconBtn, 'text-brand-text']" :title="t('Play the demonstration', 'Ver la demostración')" data-cy="library-row-catalog-video" @click="openWhenReady(async () => catalog.media(e.starter_key!).video)">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>
                  <span class="sr-only">{{ t('Demonstration', 'Demostración') }}</span>
                </button>
                <a v-if="e.media_url" :href="e.media_url" target="_blank" rel="noopener" :class="[iconBtn, 'text-brand-text']" :title="e.media_url" data-cy="library-row-link">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
                  <span class="sr-only">{{ t('Open the link', 'Abrir el enlace') }}</span>
                </a>
              </div>
              <div class="flex shrink-0">
                <button type="button" data-cy="library-edit" :class="iconBtn" :aria-label="t(`Edit ${e.name}`, `Editar ${e.name}`)" :title="t('Edit', 'Editar')" @click="openEdit(e)">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                </button>
                <button type="button" data-cy="library-archive" :class="iconBtn" :aria-label="t(`Archive ${e.name}`, `Archivar ${e.name}`)" :title="t('Archive', 'Archivar')" @click="setArchived(e, true)">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" /></svg>
                </button>
              </div>
            </div>
          </section>

          <div v-show="tab === 'programs'" id="exercises-panel-programs" role="tabpanel" aria-labelledby="exercises-tab-programs">
            <ExercisesPrograms v-if="store.accountId" ref="programsSection" :account-id="store.accountId" :exercises="active.map((e) => ({ id: e.id, name: e.name }))" @changed="load" />
          </div>
          <div v-show="tab === 'schedules'" id="exercises-panel-schedules" role="tabpanel" aria-labelledby="exercises-tab-schedules">
            <ExercisesSchedules
              v-if="store.accountId"
              ref="schedulesSection"
              :account-id="store.accountId"
              :team-member-id="store.teamMember?.id ?? null"
              :exercises="active.map((e) => ({ id: e.id, name: e.name }))"
              :names="Object.fromEntries(exercises.map((e) => [e.id, e.name]))"
            />
          </div>
          <div v-show="tab === 'catalog'" id="exercises-panel-catalog" role="tabpanel" aria-labelledby="exercises-tab-catalog">
            <ExercisesCatalog
              v-if="store.accountId"
              ref="catalogSection"
              :account-id="store.accountId"
              :team-member-id="store.teamMember?.id ?? null"
              :in-library="active.map((e) => e.starter_key).filter((s): s is string => !!s)"
              @changed="load"
            />
          </div>

          <div v-show="tab === 'archived'" id="exercises-panel-archived" role="tabpanel" aria-labelledby="exercises-tab-archived" class="flex flex-col gap-4">
            <section v-if="archived.length > 0" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="library-archived">
              <p class="px-[18px] py-3 text-[13px] text-ink-muted">{{ t("Not offered when assigning; patients who have one keep it until it's stopped on their record.", 'No se ofrecen al asignar; los pacientes que lo tienen lo conservan hasta que se retire en su ficha.') }}</p>
              <div v-for="e in archived" :key="e.id" data-cy="library-archived-row" class="flex min-h-[56px] items-center gap-3 border-t border-line-row py-2 pl-[18px] pr-3">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong class="truncate text-[14.5px] text-ink-500">{{ e.name }}</strong>
                  <span class="text-[13px] text-ink-muted">{{ countLabel(e) }}</span>
                </div>
                <UiBtn data-cy="library-restore" @click="setArchived(e, false)">{{ t('Restore', 'Recuperar') }}</UiBtn>
                <button v-if="deletable(e)" type="button" data-cy="library-delete" :class="iconBtn" :aria-label="t(`Delete ${e.name}`, `Eliminar ${e.name}`)" @click="remove(e)">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                </button>
                <span v-else class="w-9 shrink-0 touch:w-11" aria-hidden="true" />
              </div>
            </section>
            <p v-else-if="!loading" class="rounded-card border border-line bg-surface px-[18px] py-6 text-center text-[14px] text-ink-muted">{{ t('Nothing archived.', 'No hay nada archivado.') }}</p>
            <p class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700">
              {{ t('An exercise any patient has ever had can only be archived, so their history keeps its ticked days. Delete appears once archived, never assigned and in no programme or schedule.', 'Un ejercicio que algún paciente ha tenido solo se puede archivar, para que su historial conserve los días marcados. Eliminar aparece al archivarlo si nunca se ha asignado y no está en ningún programa ni pauta.') }}
            </p>
          </div>
        </div>
      </div>
    </div>
    <!-- The form, for a new exercise or the one being edited. -->
    <div v-if="panelOpen" class="fixed inset-0 z-50 flex justify-end">
      <div class="absolute inset-0 bg-scrim/20" data-cy="library-form-backdrop" @click="onBackdrop" />
      <form class="relative flex h-full w-full max-w-[460px] flex-col bg-surface shadow-drawer" role="dialog" aria-modal="true" aria-labelledby="h-library-form" data-cy="library-form" @submit.prevent="save">
        <header class="flex shrink-0 items-center gap-3 border-b border-line py-3 pl-5 pr-3">
          <h2 id="h-library-form" class="min-w-0 flex-1 truncate text-[16px] font-bold text-ink-900">{{ editingId ? t('Edit exercise', 'Editar ejercicio') : t('New exercise', 'Nuevo ejercicio') }}</h2>
          <button type="button" :class="iconBtn" :aria-label="t('Close', 'Cerrar')" data-cy="library-close" @click="closeForm">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <div class="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <label class="block text-[12.5px] font-medium text-ink-700">
            {{ t('Name', 'Nombre') }}
            <input ref="nameInput" v-model="form.name" type="text" :class="[inputClass, 'mt-1']" data-cy="library-name" />
          </label>
          <label class="block text-[12.5px] font-medium text-ink-700">
            {{ t('How to do it', 'Cómo hacerlo') }}
            <textarea v-model="form.instructions" rows="6" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" data-cy="library-instructions" />
          </label>
          <label class="block text-[12.5px] font-medium text-ink-700">
            {{ t('Video or image link (optional)', 'Enlace a vídeo o imagen (opcional)') }}
            <input v-model="form.media_url" type="text" inputmode="url" autocapitalize="off" placeholder="https://" :class="[inputClass, 'mt-1']" data-cy="library-link" />
          </label>
          <ExercisesMediaField v-if="store.accountId" v-model="form.media_path" :account-id="store.accountId" />
          <p v-if="editingCatalog && !form.media_path" class="text-[12.5px] text-ink-muted">{{ t('From the QuiroFlow catalogue: its demonstration video plays for patients unless you upload your own.', 'Del catálogo de QuiroFlow: los pacientes ven su vídeo de demostración salvo que subas uno propio.') }}</p>
          <p v-if="editingRow && reachLabel(editingRow)" class="rounded-ctl bg-surface-subtle px-3 py-2 text-[12.5px] text-ink-700" data-cy="library-form-reach">{{ reachLabel(editingRow) }}</p>
          <p v-if="formError" role="alert" class="text-[12.5px] font-semibold text-danger-text">{{ formError }}</p>
        </div>
        <footer class="flex shrink-0 gap-2 border-t border-line px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <UiBtn type="submit" variant="primary" :disabled="saving" data-cy="library-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
          <UiBtn type="button" @click="closeForm">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        </footer>
      </form>
    </div>
  </div>
</template>
