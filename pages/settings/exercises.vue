<script setup lang="ts">
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
// with it. Delete is therefore offered only for one never assigned; anything
// else is archived: off the picker, still on the patients who have it.
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
  archived_at: string | null
  current: { count: number }[]
  ever: { count: number }[]
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()
const media = useExerciseMedia()

const exercises = ref<LibraryExercise[]>([])
const loading = ref(true)

async function load() {
  // Two embedded counts of the same relation: patients doing it now (not
  // ended) and ever, which is what decides whether delete is safe.
  const { data, error } = await supabase
    .from('exercises')
    .select('id, name, instructions, media_url, media_path, archived_at, current:patient_exercises(count), ever:patient_exercises(count)')
    .is('current.ended_at', null)
    .order('name')
  if (error) showToast(error.message, 'error')
  exercises.value = (data as unknown as LibraryExercise[] | null) ?? []
  loading.value = false
}
onMounted(load)

const nowCount = (e: LibraryExercise) => e.current?.[0]?.count ?? 0
const everCount = (e: LibraryExercise) => e.ever?.[0]?.count ?? 0
const active = computed(() => exercises.value.filter((e) => !e.archived_at))
const archived = computed(() => exercises.value.filter((e) => e.archived_at))

function countLabel(e: LibraryExercise) {
  const n = nowCount(e)
  if (n === 0) return everCount(e) === 0 ? t('Never assigned', 'Nunca asignado') : t('Nobody now', 'Nadie ahora')
  return n === 1 ? t('1 patient', '1 paciente') : t(`${n} patients`, `${n} pacientes`)
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

// The form sits above the list, so whichever row opened it may be a screen
// further down: bring it into view with the name ready to type.
function focusForm() {
  nextTick(() => {
    nameInput.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    nameInput.value?.focus({ preventScroll: true })
  })
}

function openNew() {
  editingId.value = null
  adding.value = true
  Object.assign(form, { name: '', instructions: '', media_url: '', media_path: null })
  savedPath.value = null
  formError.value = ''
  focusForm()
}
function openEdit(e: LibraryExercise) {
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

          <!-- The form, for a new exercise or the one being edited. -->
          <form v-if="adding || editingId" class="flex flex-col gap-3 rounded-card border border-line bg-surface p-[18px]" data-cy="library-form" @submit.prevent="save">
            <h2 class="text-[15px] font-bold text-ink-900">{{ editingId ? t('Edit exercise', 'Editar ejercicio') : t('New exercise', 'Nuevo ejercicio') }}</h2>
            <label class="block text-[12.5px] font-medium text-ink-700">
              {{ t('Name', 'Nombre') }}
              <input ref="nameInput" v-model="form.name" type="text" :class="[inputClass, 'mt-1']" data-cy="library-name" />
            </label>
            <label class="block text-[12.5px] font-medium text-ink-700">
              {{ t('How to do it', 'Cómo hacerlo') }}
              <textarea v-model="form.instructions" rows="3" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" data-cy="library-instructions" />
            </label>
            <label class="block text-[12.5px] font-medium text-ink-700">
              {{ t('Video or image link (optional)', 'Enlace a vídeo o imagen (opcional)') }}
              <input v-model="form.media_url" type="text" inputmode="url" autocapitalize="off" placeholder="https://" :class="[inputClass, 'mt-1']" data-cy="library-link" />
            </label>
            <ExercisesMediaField v-if="store.accountId" v-model="form.media_path" :account-id="store.accountId" />
            <p v-if="formError" role="alert" class="text-[12.5px] font-semibold text-danger-text">{{ formError }}</p>
            <div class="flex gap-2">
              <UiBtn type="submit" variant="primary" :disabled="saving" data-cy="library-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
              <UiBtn type="button" @click="closeForm">{{ t('Cancel', 'Cancelar') }}</UiBtn>
            </div>
          </form>

          <section aria-labelledby="h-library" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
              <h2 id="h-library" class="flex-1 text-[16px] font-bold text-ink-900">{{ t(`In the library · ${active.length}`, `En la biblioteca · ${active.length}`) }}</h2>
              <span class="text-[13px] text-ink-muted">{{ t('Doing it now', 'Haciéndolo ahora') }}</span>
            </div>

            <template v-if="loading">
              <div v-for="i in 4" :key="i" class="flex items-center gap-4 border-t border-line-row px-[18px] py-4">
                <UiSkeleton class="h-4 w-40 rounded-ctlSm" />
                <UiSkeleton class="h-3 flex-1 rounded-ctlSm" />
              </div>
            </template>
            <p v-else-if="active.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t("No exercises yet. Add one here, or assign a new one on a patient's record.", 'Aún no hay ejercicios. Añade uno aquí, o asigna uno nuevo en la ficha de un paciente.') }}
            </p>

            <div v-for="e in active" :key="e.id" data-cy="library-row" class="flex min-h-[60px] items-center gap-3 border-t border-line-row py-2.5 pl-[18px] pr-3">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong class="truncate text-[15px] text-ink-900" data-cy="library-row-name">{{ e.name }}</strong>
                <span v-if="e.instructions" class="line-clamp-1 text-[13px] text-ink-muted">{{ e.instructions }}</span>
                <a v-if="e.media_url" :href="e.media_url" target="_blank" rel="noopener" class="truncate text-[12.5px] text-brand-text hover:underline">{{ e.media_url }}</a>
                <button v-if="e.media_path" type="button" class="self-start text-[12.5px] font-medium text-brand-text hover:underline" data-cy="library-row-media" @click="openWhenReady(() => media.signedUrl(e.media_path!))">{{ exerciseMediaKind(e.media_path) === 'video' ? t('▶ Video', '▶ Vídeo') : t('Photo', 'Foto') }}</button>
              </div>
              <span class="w-[110px] shrink-0 text-right text-[13.5px] text-ink-500" data-cy="library-row-count">{{ countLabel(e) }}</span>
              <button type="button" data-cy="library-edit" :class="iconBtn" :aria-label="t(`Edit ${e.name}`, `Editar ${e.name}`)" :title="t('Edit', 'Editar')" @click="openEdit(e)">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </button>
              <button type="button" data-cy="library-archive" :class="iconBtn" :aria-label="t(`Archive ${e.name}`, `Archivar ${e.name}`)" :title="t('Archive', 'Archivar')" @click="setArchived(e, true)">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" /></svg>
              </button>
            </div>
          </section>

          <section v-if="archived.length > 0" aria-labelledby="h-archived" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="library-archived">
            <div class="px-[18px] pb-3 pt-4">
              <h2 id="h-archived" class="text-[16px] font-bold text-ink-900">{{ t(`Archived · ${archived.length}`, `Archivados · ${archived.length}`) }}</h2>
              <p class="mt-1 text-[13px] text-ink-muted">{{ t("Not offered when assigning; patients who have one keep it until it's stopped on their record.", 'No se ofrecen al asignar; los pacientes que lo tienen lo conservan hasta que se retire en su ficha.') }}</p>
            </div>
            <div v-for="e in archived" :key="e.id" data-cy="library-archived-row" class="flex min-h-[60px] items-center gap-3 border-t border-line-row py-2 pl-[18px] pr-3">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong class="truncate text-[15px] text-ink-500">{{ e.name }}</strong>
                <span class="text-[13px] text-ink-muted">{{ countLabel(e) }}</span>
              </div>
              <UiBtn data-cy="library-restore" @click="setArchived(e, false)">{{ t('Restore', 'Recuperar') }}</UiBtn>
              <button v-if="everCount(e) === 0" type="button" data-cy="library-delete" :class="iconBtn" :aria-label="t(`Delete ${e.name}`, `Eliminar ${e.name}`)" @click="remove(e)">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
              </button>
              <span v-else class="w-9 shrink-0 touch:w-11" aria-hidden="true" />
            </div>
          </section>

          <p class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700">
            {{ t('An exercise any patient has ever had can only be archived, so their history keeps its ticked days. Delete appears once archived and never assigned.', 'Un ejercicio que algún paciente ha tenido solo se puede archivar, para que su historial conserve los días marcados. Eliminar aparece al archivarlo si nunca se ha asignado.') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
