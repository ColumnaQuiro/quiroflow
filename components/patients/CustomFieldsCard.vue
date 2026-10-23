<script setup lang="ts">
import {
  PATIENT_ATTRIBUTE_COLUMNS,
  formatPatientAttributeValue,
  normalizePatientAttributeValue,
  type PatientAttribute,
  type PatientAttributeSection,
} from '~/utils/patientAttributes'

// The clinic's own fields on the patient's record (Settings > Custom fields),
// one card per section: the clinical ones on Clinical, the admin ones in
// Datos del paciente. Edited here and saved at once, as the phone numbers
// and the family are, rather than through the record's main form.
//
// A clinical field is read like a visit note. Without visit_notes_access the
// database returns none of their values, and this card does not show at all
// rather than show the fields as blank.
const props = defineProps<{ patientId: string; section: PatientAttributeSection }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { can } = usePermission()
const { showToast } = useToast()

const allowed = computed(() => props.section === 'admin' || can('visit_notes_access'))

const attributes = ref<PatientAttribute[]>([])
const values = ref<Record<string, string>>({})
const loading = ref(true)

async function load() {
  if (!allowed.value) {
    loading.value = false
    return
  }
  const [{ data: attrs, error: attrsError }, { data: rows, error: rowsError }] = await Promise.all([
    supabase.from('patient_attributes').select(PATIENT_ATTRIBUTE_COLUMNS).eq('section', props.section).is('archived_at', null).order('position').order('created_at'),
    supabase.from('patient_attribute_values').select('attribute_id, value').eq('patient_id', props.patientId),
  ])
  if (attrsError) throw attrsError
  if (rowsError) throw rowsError
  attributes.value = (attrs as PatientAttribute[] | null) ?? []
  values.value = Object.fromEntries((rows ?? []).map((r) => [r.attribute_id, r.value]))
  loading.value = false
}
onMounted(load)
watch(() => props.patientId, load)

const editing = ref(false)
const draft = ref<Record<string, string | null>>({})
const saving = ref(false)
function startEditing() {
  draft.value = Object.fromEntries(attributes.value.map((a) => [a.id, values.value[a.id] ?? null]))
  editing.value = true
}

async function save() {
  if (saving.value) return
  const upserts: { account_id: string; patient_id: string; attribute_id: string; value: string; updated_by: string | null }[] = []
  const cleared: string[] = []
  for (const a of attributes.value) {
    const next = normalizePatientAttributeValue(a.kind, draft.value[a.id])
    const current = values.value[a.id] ?? null
    if (next === current) continue
    if (next === null) cleared.push(a.id)
    else upserts.push({ account_id: store.accountId!, patient_id: props.patientId, attribute_id: a.id, value: next, updated_by: store.teamMember?.id ?? null })
  }
  saving.value = true
  const [upserted, deleted] = await Promise.all([
    upserts.length ? supabase.from('patient_attribute_values').upsert(upserts, { onConflict: 'patient_id,attribute_id' }) : null,
    cleared.length ? supabase.from('patient_attribute_values').delete().eq('patient_id', props.patientId).in('attribute_id', cleared) : null,
  ])
  saving.value = false
  const error = upserted?.error ?? deleted?.error
  if (error) {
    showToast(error.message, 'error')
    return
  }
  editing.value = false
  await load()
  showToast(t('Saved', 'Guardado'))
}

const title = computed(() => (props.section === 'clinical' ? t('Clinic fields', 'Campos de la clínica') : t('More details', 'Más datos')))
</script>

<template>
  <section
    v-if="allowed && (loading || attributes.length > 0)"
    :aria-labelledby="`custom-fields-${section}-h`"
    class="rounded-card border border-line bg-surface p-4 shadow-card"
    :data-cy="`custom-fields-${section}`"
    :data-ready="loading ? undefined : 'true'"
  >
    <div class="flex items-center justify-between gap-2">
      <h2 :id="`custom-fields-${section}-h`" class="text-[13.5px] font-semibold text-ink-700">{{ title }}</h2>
      <UiIconBtn v-if="!loading && !editing && can('patients_edit')" icon="pencil" :label="t('Edit', 'Editar')" data-cy="custom-fields-edit" @click="startEditing" />
    </div>

    <UiSkeleton v-if="loading" class="mt-3 h-4 w-48 rounded-ctlSm" />

    <dl v-else-if="!editing" class="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <div v-for="a in attributes" :key="a.id" data-cy="custom-field" :data-key="a.key">
        <dt class="text-[11.5px] text-ink-muted2">{{ a.label }}</dt>
        <dd class="mt-0.5 whitespace-pre-wrap text-[13.5px]" :class="values[a.id] ? 'text-ink-700' : 'text-ink-faint'" data-cy="custom-field-value">
          {{ formatPatientAttributeValue(a.kind, values[a.id], t) || t('Not recorded', 'Sin registrar') }}
        </dd>
      </div>
    </dl>

    <form v-else class="mt-3 space-y-3" data-cy="custom-fields-form" @submit.prevent="save">
      <div class="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <div v-for="a in attributes" :key="a.id" :class="a.kind === 'long_text' ? 'sm:col-span-2' : ''">
          <label :for="`cf-${a.id}`" class="block text-[12px] font-medium text-ink-muted">{{ a.label }}</label>
          <PatientsAttributeInput v-model="draft[a.id]" :attribute="a" :input-id="`cf-${a.id}`" />
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <UiBtn variant="secondary" size="sm" @click="editing = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <UiBtn type="submit" variant="primary" size="sm" :disabled="saving" data-cy="custom-fields-save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
      </div>
    </form>
  </section>
</template>
