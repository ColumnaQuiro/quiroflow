<script setup lang="ts">
import { PATIENT_TYPE_COLORS, PATIENT_TYPE_DOT, type PatientType, type PatientTypeColor } from '~/composables/usePatientTypes'

// Settings > Patient types: the categories a clinic groups its patients by
// (Joven, Mayor de 65, Deportista...). Each patient can have several, given
// on their record or many at once from the Patients list. What a type brings
// -- its exercises -- is chosen in Exercises > By type; the automations that
// start on one are in Automations.
//
// Unlike tags, which are free text, a type is a row: renaming it renames it
// everywhere. A tag already used this way can be turned into a type here,
// with everyone who has it.
const t = useT()
const supabase = useSupabaseClient()
const { showToast } = useToast()
const { can } = usePermission()
const { types, active, loading, load, create, update, remove, convertTag } = usePatientTypes()
onMounted(load)

const archived = computed(() => types.value.filter((x) => x.archived_at))

// --- new ---
const name = ref('')
const color = ref<PatientTypeColor>('indigo')
const saving = ref(false)
const addError = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
async function add() {
  if (!name.value.trim() || saving.value) return
  saving.value = true
  addError.value = ''
  const r = await create(name.value, color.value)
  saving.value = false
  if ('error' in r) {
    addError.value = /unique|duplicate/i.test(r.error) ? t('There is already a type with that name.', 'Ya hay un tipo con ese nombre.') : r.error
    return
  }
  name.value = ''
  color.value = PATIENT_TYPE_COLORS[(active.value.length) % PATIENT_TYPE_COLORS.length]!
}

// --- rename / recolour ---
const editingId = ref<string | null>(null)
const editName = ref('')
function startEdit(ty: PatientType) {
  editingId.value = ty.id
  editName.value = ty.name
}
async function saveEdit(ty: PatientType) {
  const next = editName.value.trim()
  if (!next || next === ty.name) {
    editingId.value = null
    return
  }
  const err = await update(ty.id, { name: next })
  if (err) return showToast(/unique|duplicate/i.test(err) ? t('There is already a type with that name.', 'Ya hay un tipo con ese nombre.') : err, 'error')
  editingId.value = null
}
async function recolour(ty: PatientType, c: PatientTypeColor) {
  const err = await update(ty.id, { color: c })
  if (err) showToast(err, 'error')
}
async function setArchived(ty: PatientType, on: boolean) {
  const err = await update(ty.id, { archived_at: on ? new Date().toISOString() : null })
  if (err) showToast(/unique|duplicate/i.test(err) ? t('There is already an active type with that name.', 'Ya hay un tipo activo con ese nombre.') : err, 'error')
}
const deleting = ref<PatientType | null>(null)
async function confirmDelete() {
  const ty = deleting.value
  if (!ty) return
  const err = await remove(ty.id)
  deleting.value = null
  if (err) showToast(err, 'error')
}

// --- tags into types ---
const tags = ref<string[]>([])
const tag = ref('')
const converting = ref(false)
onMounted(async () => {
  const { data } = await supabase.rpc('patient_tags')
  tags.value = ((data ?? []) as unknown as ({ tag: string } | string)[]).map((r) => (typeof r === 'string' ? r : r.tag)).filter(Boolean)
})
async function convert() {
  if (!tag.value || converting.value) return
  converting.value = true
  const r = await convertTag(tag.value)
  converting.value = false
  if ('error' in r) return showToast(r.error, 'error')
  const ty = types.value.find((x) => x.id === r.id)
  showToast(t(`“${tag.value}” is now a type, with ${ty?.members ?? 0} patients`, `«${tag.value}» ya es un tipo, con ${ty?.members ?? 0} pacientes`))
  tag.value = ''
}

const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700'
const input = 'h-9 touch:h-11 min-w-0 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const membersLabel = (n: number) => (n === 1 ? t('1 patient', '1 paciente') : t(`${n} patients`, `${n} pacientes`))
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Patient types', 'Tipos de paciente')">
      <UiBtn variant="primary" @click="nameInput?.focus()">{{ t('New type', 'Nuevo tipo') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="settings-list" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{
              t(
                'Groups you put patients in, such as Young, Over 65 or Athlete. A patient can have several. Each type can bring exercises with it (Exercises › By type) and start automations.',
                'Grupos en los que pones a tus pacientes, como Joven, Mayor de 65 o Deportista. Un paciente puede tener varios. Cada tipo puede traer ejercicios (Ejercicios › Por tipo) y disparar automatizaciones.',
              )
            }}
          </p>

          <section aria-labelledby="h-types" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
              <h2 id="h-types" class="flex-1 text-[16px] font-bold text-ink-900">{{ t(`Types · ${active.length}`, `Tipos · ${active.length}`) }}</h2>
              <span class="text-[13px] text-ink-muted">{{ t('Patients', 'Pacientes') }}</span>
            </div>
            <template v-if="loading">
              <div v-for="i in 3" :key="i" class="flex items-center gap-4 border-t border-line-row px-[18px] py-4"><UiSkeleton class="h-4 w-40 rounded-ctlSm" /></div>
            </template>
            <p v-else-if="active.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t('No types yet. Add the first one below.', 'Aún no hay tipos. Añade el primero abajo.') }}
            </p>
            <div v-for="ty in active" :key="ty.id" data-cy="type-row" class="flex min-h-[60px] flex-wrap items-center gap-3 border-t border-line-row py-2 pl-[18px] pr-3">
              <div class="flex gap-1" role="radiogroup" :aria-label="t('Colour', 'Color')">
                <button
                  v-for="c in PATIENT_TYPE_COLORS"
                  :key="c"
                  type="button"
                  role="radio"
                  :aria-checked="ty.color === c"
                  :aria-label="c"
                  class="flex h-5 w-5 items-center justify-center rounded-full touch:h-7 touch:w-7"
                  :class="ty.color === c ? 'ring-2 ring-ink-500 ring-offset-1 ring-offset-surface' : ''"
                  @click="recolour(ty, c)"
                >
                  <span class="h-3 w-3 rounded-full" :style="{ background: PATIENT_TYPE_DOT[c] }" />
                </button>
              </div>
              <form v-if="editingId === ty.id" class="flex min-w-0 flex-1 gap-2" @submit.prevent="saveEdit(ty)">
                <input v-model="editName" maxlength="40" :class="[input, 'flex-1']" data-cy="type-rename-input" @keydown.esc="editingId = null" />
                <UiBtn type="submit" size="sm" data-cy="type-rename-save">{{ t('Save', 'Guardar') }}</UiBtn>
              </form>
              <strong v-else class="min-w-0 flex-1 truncate text-[15px] text-ink-900" data-cy="type-name">{{ ty.name }}</strong>
              <NuxtLink :to="{ path: '/patients', query: { types: ty.id } }" class="w-[92px] shrink-0 text-right text-[13.5px] text-ink-500 hover:text-brand-text" data-cy="type-count">{{ membersLabel(ty.members) }}</NuxtLink>
              <span v-if="ty.exercise_program_id || ty.exercise_schedule_id" class="rounded-pill bg-brand-tint px-2 py-px text-[11.5px] font-medium text-brand-text">{{ t('brings exercises', 'trae ejercicios') }}</span>
              <button type="button" :class="iconBtn" :aria-label="t(`Rename ${ty.name}`, `Renombrar ${ty.name}`)" data-cy="type-rename" @click="startEdit(ty)">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </button>
              <button type="button" :class="iconBtn" :aria-label="t(`Archive ${ty.name}`, `Archivar ${ty.name}`)" :title="t('Archive', 'Archivar')" data-cy="type-archive" @click="setArchived(ty, true)">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" /></svg>
              </button>
            </div>
            <form class="flex flex-wrap items-center gap-2.5 border-t border-line-row bg-surface-subtle py-3 pl-[18px] pr-3" @submit.prevent="add">
              <div class="flex gap-1" role="radiogroup" :aria-label="t('Colour', 'Color')">
                <button
                  v-for="c in PATIENT_TYPE_COLORS"
                  :key="c"
                  type="button"
                  role="radio"
                  :aria-checked="color === c"
                  :aria-label="c"
                  class="flex h-5 w-5 items-center justify-center rounded-full touch:h-7 touch:w-7"
                  :class="color === c ? 'ring-2 ring-ink-500 ring-offset-1 ring-offset-surface-subtle' : ''"
                  @click="color = c"
                >
                  <span class="h-3 w-3 rounded-full" :style="{ background: PATIENT_TYPE_DOT[c] }" />
                </button>
              </div>
              <input
                ref="nameInput"
                v-model="name"
                maxlength="40"
                data-cy="type-new-name"
                :placeholder="t('Add a type, e.g. Over 65', 'Añade un tipo, ej. Mayor de 65')"
                :aria-label="t('New type name', 'Nombre del nuevo tipo')"
                :class="[input, 'flex-1']"
              />
              <UiBtn type="submit" data-cy="type-new-save" :disabled="saving || !name.trim()">{{ saving ? t('Adding…', 'Añadiendo…') : t('Add', 'Añadir') }}</UiBtn>
              <p v-if="addError" class="w-full text-[12.5px] font-semibold text-danger-text">{{ addError }}</p>
            </form>
          </section>

          <section v-if="tags.length" aria-labelledby="h-tags" class="rounded-card border border-line bg-surface px-[18px] py-4">
            <h2 id="h-tags" class="text-[15px] font-bold text-ink-900">{{ t('Turn a tag into a type', 'Convertir una etiqueta en tipo') }}</h2>
            <p class="mt-1 text-[13px] text-ink-muted">
              {{ t('Makes a type with the tag\'s name and gives it to everyone who has the tag. The tag itself stays.', 'Crea un tipo con el nombre de la etiqueta y se lo pone a todos los que la tienen. La etiqueta se queda.') }}
            </p>
            <form class="mt-3 flex flex-wrap gap-2" @submit.prevent="convert">
              <select v-model="tag" :class="[input, 'flex-1']" data-cy="type-convert-tag">
                <option value="">{{ t('Choose a tag…', 'Elige una etiqueta…') }}</option>
                <option v-for="x in tags" :key="x" :value="x">{{ x }}</option>
              </select>
              <UiBtn type="submit" :disabled="!tag || converting" data-cy="type-convert-save">{{ t('Convert', 'Convertir') }}</UiBtn>
            </form>
          </section>

          <section v-if="archived.length" aria-labelledby="h-archived" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="types-archived">
            <h2 id="h-archived" class="px-[18px] pb-2 pt-4 text-[15px] font-bold text-ink-900">{{ t('Archived', 'Archivados') }}</h2>
            <p class="px-[18px] pb-3 text-[13px] text-ink-muted">{{ t('Not offered on records any more. Patients who had one keep it until it is taken away.', 'Ya no se ofrecen en las fichas. Quien lo tenía lo conserva hasta que se le quite.') }}</p>
            <div v-for="ty in archived" :key="ty.id" class="flex min-h-[56px] items-center gap-3 border-t border-line-row py-2 pl-[18px] pr-3">
              <span class="h-2.5 w-2.5 rounded-full" :style="{ background: PATIENT_TYPE_DOT[ty.color] }" aria-hidden="true" />
              <strong class="min-w-0 flex-1 truncate text-[14.5px] text-ink-500">{{ ty.name }}</strong>
              <span class="text-[13px] text-ink-muted">{{ membersLabel(ty.members) }}</span>
              <UiBtn size="sm" data-cy="type-restore" @click="setArchived(ty, false)">{{ t('Restore', 'Recuperar') }}</UiBtn>
              <button type="button" :class="iconBtn" :aria-label="t(`Delete ${ty.name}`, `Eliminar ${ty.name}`)" data-cy="type-delete" @click="deleting = ty">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
              </button>
            </div>
          </section>
          <p v-if="can('exercises_manage')" class="text-[13px] text-ink-muted">
            <NuxtLink to="/exercises?section=types" class="font-semibold text-brand-text hover:underline">{{ t('Choose what each type brings in Exercises › By type', 'Elige qué trae cada tipo en Ejercicios › Por tipo') }}</NuxtLink>
          </p>
        </div>
      </div>
    </div>
    <UiConfirmDialog
      v-if="deleting"
      :title="t(`Delete “${deleting.name}”?`, `¿Eliminar «${deleting.name}»?`)"
      :confirm-label="t('Delete', 'Eliminar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      tone="danger"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p class="text-[13px] text-ink-700">
        {{ t(`It is taken off the ${deleting.members} patients who have it. Their exercises stay.`, `Se quita a los ${deleting.members} pacientes que lo tienen. Sus ejercicios se quedan.`) }}
      </p>
    </UiConfirmDialog>
  </div>
</template>
