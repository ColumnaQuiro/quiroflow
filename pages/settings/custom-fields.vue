<script setup lang="ts">
import {
  PATIENT_ATTRIBUTE_COLUMNS,
  PATIENT_ATTRIBUTE_KINDS,
  patientAttributeKeyFromLabel,
  patientAttributeKindLabel,
  patientAttributeMergeToken,
  type PatientAttribute,
  type PatientAttributeKind,
  type PatientAttributeSection,
} from '~/utils/patientAttributes'

// Settings > Custom fields: the clinic's own fields on the patient's record
// (patient_attributes, 20261023053614_custom_patient_fields.sql), beyond the
// fixed ones -- "Mutua / nº póliza", "Deporte que practica", "Lateralidad".
//
// Two sections, as PracticeHub has them. Clinical fields sit on the Clinical
// tab and are read like visit notes, by roles with clinical access only;
// admin fields sit in Datos del paciente, for everyone who sees the patient.
// Whether one is asked for when adding a patient is New Patient Fields'
// business, beside the standard fields, not repeated here.
//
// A field with answers is archived rather than deleted: it leaves the record
// and the forms, and its answers stay in the patient's export and for when it
// is restored. Its type is fixed once anyone has answered it.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const section = ref<PatientAttributeSection>('clinical')
const all = ref<PatientAttribute[]>([])
const uses = ref<Record<string, number>>({})
const loading = ref(true)

async function load() {
  const { data, error } = await supabase.from('patient_attributes').select(PATIENT_ATTRIBUTE_COLUMNS).order('position').order('created_at')
  if (error) throw error
  all.value = (data as PatientAttribute[] | null) ?? []
  loading.value = false
  const counts = await Promise.all(all.value.map((a) => supabase.from('patient_attribute_values').select('id', { count: 'exact', head: true }).eq('attribute_id', a.id)))
  uses.value = Object.fromEntries(all.value.map((a, i) => [a.id, counts[i].count ?? 0]))
}
onMounted(load)

const active = computed(() => all.value.filter((a) => a.section === section.value && !a.archived_at))
const archived = computed(() => all.value.filter((a) => a.section === section.value && a.archived_at))
const countIn = (s: PatientAttributeSection) => all.value.filter((a) => a.section === s && !a.archived_at).length

function usesLabel(id: string) {
  const n = uses.value[id]
  if (n === undefined) return ''
  if (n === 0) return t('No answers yet', 'Sin respuestas')
  return n === 1 ? t('1 patient', '1 paciente') : t(`${n} patients`, `${n} pacientes`)
}
const mergeField = (key: string) => '{' + '{' + patientAttributeMergeToken(key) + '}' + '}'
function kindSummary(a: PatientAttribute) {
  const kind = patientAttributeKindLabel(a.kind, t)
  return a.kind === 'choice' ? `${kind}: ${a.options.join(' · ')}` : kind
}

// -- Adding and editing ---------------------------------------------------------
interface Draft {
  id: string | null
  label: string
  section: PatientAttributeSection
  kind: PatientAttributeKind
  options: string
}
const draft = ref<Draft | null>(null)
const formError = ref('')
const saving = ref(false)

function startAdd() {
  formError.value = ''
  draft.value = { id: null, label: '', section: section.value, kind: 'text', options: '' }
}
function startEdit(a: PatientAttribute) {
  formError.value = ''
  draft.value = { id: a.id, label: a.label, section: a.section, kind: a.kind, options: a.options.join('\n') }
}
const kindLocked = computed(() => !!draft.value?.id && (uses.value[draft.value.id] ?? 1) > 0)

async function saveDraft() {
  const d = draft.value
  if (!d || saving.value) return
  formError.value = ''
  const label = d.label.trim()
  const options = d.kind === 'choice' ? [...new Set(d.options.split('\n').map((o) => o.trim()).filter(Boolean))] : []
  if (!label) {
    formError.value = t('Give the field a name.', 'Ponle un nombre al campo.')
    return
  }
  if (all.value.some((a) => a.id !== d.id && a.section === d.section && a.label.toLowerCase() === label.toLowerCase())) {
    formError.value = t('There is already a field with that name.', 'Ya hay un campo con ese nombre.')
    return
  }
  if (d.kind === 'choice' && options.length < 2) {
    formError.value = t('A single choice needs at least two options, one per line.', 'Una selección única necesita al menos dos opciones, una por línea.')
    return
  }
  saving.value = true
  let error
  if (d.id) {
    const before = all.value.find((a) => a.id === d.id)
    // Moving it to the other section puts it at the end of that one.
    const position = before && before.section !== d.section ? nextPosition(d.section) : before?.position
    ;({ error } = await supabase.from('patient_attributes').update({ label, section: d.section, kind: d.kind, options, position }).eq('id', d.id))
  } else {
    const key = patientAttributeKeyFromLabel(label, all.value.map((a) => a.key))
    ;({ error } = await supabase
      .from('patient_attributes')
      .insert({ account_id: store.accountId!, label, key, section: d.section, kind: d.kind, options, position: nextPosition(d.section) }))
  }
  saving.value = false
  if (error) {
    formError.value = error.message
    return
  }
  section.value = d.section
  draft.value = null
  await load()
  showToast(t('Saved', 'Guardado'))
}
function nextPosition(s: PatientAttributeSection) {
  return Math.max(-1, ...all.value.filter((a) => a.section === s).map((a) => a.position)) + 1
}

// -- Order ----------------------------------------------------------------------
// Positions are rewritten for the whole section, so fields made before there
// was any order (all at 0) settle into the one on screen.
async function move(index: number, by: -1 | 1) {
  const list = [...active.value]
  const other = index + by
  if (other < 0 || other >= list.length) return
  ;[list[index], list[other]] = [list[other], list[index]]
  const changed = list.map((a, i) => ({ a, position: i })).filter(({ a, position }) => a.position !== position)
  for (const { a, position } of changed) a.position = position
  all.value = [...all.value].sort((x, y) => x.position - y.position)
  const results = await Promise.all(changed.map(({ a, position }) => supabase.from('patient_attributes').update({ position }).eq('id', a.id)))
  const failed = results.find((r) => r.error)
  if (failed?.error) {
    showToast(failed.error.message, 'error')
    await load()
  }
}

// -- Archive, restore, delete ---------------------------------------------------
async function setArchived(a: PatientAttribute, archive: boolean) {
  const { error } = await supabase
    .from('patient_attributes')
    .update({ archived_at: archive ? new Date().toISOString() : null, position: archive ? a.position : nextPosition(a.section) })
    .eq('id', a.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  await load()
}
const deleting = ref<PatientAttribute | null>(null)
async function confirmDelete() {
  if (!deleting.value) return
  const { error } = await supabase.from('patient_attributes').delete().eq('id', deleting.value.id)
  if (error) {
    // The values' foreign key: someone has answered it since the count, or
    // has an answer this role cannot see (a clinical field).
    showToast(t('It has answers, so it can only be archived.', 'Tiene respuestas, así que solo se puede archivar.'), 'error')
    deleting.value = null
    return
  }
  deleting.value = null
  await load()
}

const inputClass = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700 disabled:opacity-30 disabled:hover:bg-transparent'
const SECTIONS = computed<{ value: PatientAttributeSection; label: string; hint: string }[]>(() => [
  {
    value: 'clinical',
    label: t('Clinical', 'Clínicos'),
    hint: t('On the Clinical tab. Only roles with clinical access see them, as with visit notes.', 'En la pestaña Clínico. Solo los ven los roles con acceso clínico, como las notas de visita.'),
  },
  { value: 'admin', label: t('Admin', 'Administrativos'), hint: t('In Patient details, for everyone who can see the patient.', 'En Datos del paciente, para todos los que ven al paciente.') },
])
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Custom Fields', 'Campos personalizados')">
      <UiBtn variant="primary" data-cy="attr-add" :disabled="loading" @click="startAdd">{{ t('Add field', 'Añadir campo') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="attr-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Your own fields on the patient’s record, beyond the standard ones. To ask for one when adding a patient, turn it on in', 'Campos propios en la ficha del paciente, además de los estándar. Para pedirlo al añadir un paciente, actívalo en') }}
            <NuxtLink to="/settings/new-patient-fields" class="font-medium text-brand-text hover:underline">{{ t('New Patient Fields', 'Campos de nuevo paciente') }}</NuxtLink>.
          </p>

          <div role="tablist" class="inline-flex self-start gap-0.5 rounded-[9px] bg-chip-bg p-[3px]">
            <button
              v-for="s in SECTIONS"
              :key="s.value"
              type="button"
              role="tab"
              :aria-selected="section === s.value"
              :data-cy="`attr-section-${s.value}`"
              class="h-8 touch:h-11 rounded-[7px] px-3 text-[13px]"
              :class="section === s.value ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900'"
              @click="section = s.value"
            >
              {{ s.label }} <span class="font-normal text-ink-muted">{{ countIn(s.value) }}</span>
            </button>
          </div>

          <section class="overflow-hidden rounded-card border border-line bg-surface" :aria-label="SECTIONS.find((s) => s.value === section)?.label">
            <p class="px-[18px] pb-3 pt-4 text-[13px] text-ink-muted">{{ SECTIONS.find((s) => s.value === section)?.hint }}</p>
            <template v-if="loading">
              <div v-for="i in 3" :key="i" class="flex items-center gap-3 border-t border-line-row px-[18px] py-4">
                <UiSkeleton class="h-4 w-40 rounded-ctlSm" />
                <UiSkeleton class="ml-auto h-4 w-24 rounded-ctlSm" />
              </div>
            </template>
            <p v-else-if="active.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t('No fields here yet.', 'Aún no hay campos aquí.') }}
              <button type="button" class="font-medium text-brand-text hover:underline" @click="startAdd">{{ t('Add the first one', 'Añade el primero') }}</button>
            </p>
            <div
              v-for="(a, i) in active"
              v-else
              :key="a.id"
              data-cy="attr-row"
              :data-key="a.key"
              class="flex min-h-[60px] flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-row py-2 pl-[18px] pr-3 sm:flex-nowrap"
            >
              <div class="flex min-w-[10rem] flex-1 flex-col gap-0.5">
                <strong class="truncate text-[14.5px] text-ink-900" data-cy="attr-label">{{ a.label }}</strong>
                <span class="truncate text-[12.5px] text-ink-muted">{{ kindSummary(a) }} · <code class="text-[11.5px]" :title="t('Merge field for document templates', 'Campo para plantillas de documentos')">{{ mergeField(a.key) }}</code></span>
              </div>
              <span class="text-[12.5px] text-ink-500">{{ usesLabel(a.id) }}</span>
              <div class="flex items-center">
                <button type="button" :class="iconBtn" :disabled="i === 0" :aria-label="t(`Move ${a.label} up`, `Subir ${a.label}`)" data-cy="attr-up" @click="move(i, -1)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                </button>
                <button type="button" :class="iconBtn" :disabled="i === active.length - 1" :aria-label="t(`Move ${a.label} down`, `Bajar ${a.label}`)" data-cy="attr-down" @click="move(i, 1)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                <button type="button" :class="iconBtn" :aria-label="t(`Edit ${a.label}`, `Editar ${a.label}`)" data-cy="attr-edit" @click="startEdit(a)">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
                </button>
                <button type="button" :class="iconBtn" :aria-label="t(`Archive ${a.label}`, `Archivar ${a.label}`)" data-cy="attr-archive" @click="setArchived(a, true)">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16v3H4zM6 10v9h12v-9M10 14h4" /></svg>
                </button>
              </div>
            </div>
          </section>

          <details v-if="archived.length > 0" class="rounded-card border border-line bg-surface" data-cy="attr-archived">
            <summary class="cursor-pointer px-[18px] py-3 text-[13.5px] font-semibold text-ink-700">{{ t(`Archived · ${archived.length}`, `Archivados · ${archived.length}`) }}</summary>
            <div v-for="a in archived" :key="a.id" data-cy="attr-archived-row" class="flex min-h-[52px] flex-wrap items-center gap-3 border-t border-line-row py-1.5 pl-[18px] pr-3">
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-[14px] text-ink-700">{{ a.label }}</span>
                <span class="text-[12px] text-ink-muted">{{ patientAttributeKindLabel(a.kind, t) }} · {{ usesLabel(a.id) }}</span>
              </div>
              <UiBtn variant="ghost" size="sm" data-cy="attr-restore" @click="setArchived(a, false)">{{ t('Restore', 'Restaurar') }}</UiBtn>
              <UiBtn v-if="uses[a.id] === 0" variant="ghost" size="sm" data-cy="attr-delete" @click="deleting = a">{{ t('Delete', 'Eliminar') }}</UiBtn>
            </div>
          </details>
        </div>
      </div>
    </div>

    <!-- Add / edit -->
    <div v-if="draft" class="fixed inset-0 z-50 flex items-end justify-center bg-scrim/30 sm:items-center sm:p-4" @click.self="draft = null">
      <form
        role="dialog"
        aria-modal="true"
        :aria-label="draft.id ? t('Edit field', 'Editar campo') : t('Add field', 'Añadir campo')"
        class="flex max-h-[92vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-card bg-surface p-5 shadow-drawer sm:rounded-card"
        data-cy="attr-form"
        @submit.prevent="saveDraft"
      >
        <h2 class="text-[15px] font-semibold text-ink-900">{{ draft.id ? t('Edit field', 'Editar campo') : t('Add field', 'Añadir campo') }}</h2>
        <label class="block text-[12.5px] font-semibold text-ink-700">
          {{ t('Name', 'Nombre') }}
          <input v-model="draft.label" type="text" maxlength="80" required :placeholder="t('e.g. Sport they play', 'ej. Deporte que practica')" :class="[inputClass, 'mt-1']" data-cy="attr-form-label" />
        </label>
        <label class="block text-[12.5px] font-semibold text-ink-700">
          {{ t('Section', 'Sección') }}
          <select v-model="draft.section" :class="[inputClass, 'mt-1']" data-cy="attr-form-section">
            <option v-for="s in SECTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
          </select>
          <span class="mt-1 block text-[12px] font-normal text-ink-muted">{{ SECTIONS.find((s) => s.value === draft!.section)?.hint }}</span>
        </label>
        <label class="block text-[12.5px] font-semibold text-ink-700">
          {{ t('Type', 'Tipo') }}
          <select v-model="draft.kind" :disabled="kindLocked" :class="[inputClass, 'mt-1 disabled:bg-surface-subtle disabled:text-ink-muted']" data-cy="attr-form-kind">
            <option v-for="k in PATIENT_ATTRIBUTE_KINDS" :key="k" :value="k">{{ patientAttributeKindLabel(k, t) }}</option>
          </select>
          <span v-if="kindLocked" class="mt-1 block text-[12px] font-normal text-ink-muted">{{ t('Patients have answers in it, so its type stays.', 'Hay pacientes con respuestas, así que el tipo no cambia.') }}</span>
        </label>
        <label v-if="draft.kind === 'choice'" class="block text-[12.5px] font-semibold text-ink-700">
          {{ t('Options, one per line', 'Opciones, una por línea') }}
          <textarea
            v-model="draft.options"
            rows="4"
            :placeholder="t('Right\nLeft\nBoth', 'Diestro\nZurdo\nAmbidiestro')"
            class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            data-cy="attr-form-options"
          />
          <span v-if="draft.id" class="mt-1 block text-[12px] font-normal text-ink-muted">{{ t('Rewording an option leaves answers already given as they were.', 'Cambiar una opción no modifica las respuestas ya dadas.') }}</span>
        </label>
        <p v-if="formError" class="text-[12.5px] font-semibold text-danger-text" data-cy="attr-form-error">{{ formError }}</p>
        <div class="flex justify-end gap-2">
          <UiBtn variant="ghost" @click="draft = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          <UiBtn type="submit" variant="primary" :disabled="saving" data-cy="attr-form-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        </div>
      </form>
    </div>

    <UiConfirmDialog
      v-if="deleting"
      tone="danger"
      :title="t(`Delete “${deleting.label}”?`, `¿Eliminar «${deleting.label}»?`)"
      :confirm-label="t('Delete field', 'Eliminar campo')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('No patient has an answer in it, so nothing is lost.', 'Ningún paciente tiene respuesta en él, así que no se pierde nada.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
