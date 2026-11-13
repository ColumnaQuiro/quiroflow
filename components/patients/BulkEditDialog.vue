<script setup lang="ts">
import type { Json } from '~/types/database.types'
import type { PatientSelection } from '~/composables/usePatientTypes'

// Archive or reactivate, set the practitioner, or add or take away a tag for
// many patients at once, from the Patients list. One change per dialog, done
// by bulk_update_patients (20261113143728_patients_bulk_edit.sql) as the
// caller, so their role and patient scope apply row by row exactly as they
// would on each record -- and the whole change is refused, not half done,
// when a row trips a guard (a tag removed without patients_tags_remove).
export type BulkEditKind = 'archive' | 'reactivate' | 'practitioner' | 'tags'

const props = defineProps<{
  kind: BulkEditKind
  selection: PatientSelection
  count: number
  practitioners: { id: string; full_name: string }[]
}>()
const emit = defineEmits<{ done: [summary: string]; cancel: [] }>()
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()

const busy = ref(false)
const error = ref('')
const fieldId = `bulk-edit-${Math.random().toString(36).slice(2, 9)}`

// Practitioner: a team member, or none (clears it).
const NONE = '__none__'
const practitioner = ref('')

// Tags: give one (typed or picked) or take one away (picked).
const { can } = usePermission()
const canRemoveTags = computed(() => can('patients_tags_remove'))
const tagMode = ref<'add' | 'remove'>('add')
const tagInput = ref('')
const tagToRemove = ref('')
const knownTags = ref<string[]>([])
onMounted(async () => {
  if (props.kind !== 'tags') return
  const { data } = await supabase.rpc('patient_tags')
  knownTags.value = (data ?? []).map((r) => r.tag)
  tagToRemove.value = knownTags.value[0] ?? ''
})
// The known tags containing what is typed (all of them while empty).
const tagSuggestions = computed(() => {
  const typed = tagInput.value.trim().toLocaleLowerCase('es')
  return knownTags.value.filter((tag) => tag.toLocaleLowerCase('es').includes(typed)).slice(0, 12)
})

function patientsN(n: number) {
  return n === 1 ? t('1 patient', '1 paciente') : t(`${n} patients`, `${n} pacientes`)
}
const patientsLabel = computed(() => patientsN(props.count))

const title = computed(() => {
  switch (props.kind) {
    case 'archive':
      return t(`Archive ${patientsLabel.value}?`, `¿Archivar ${patientsLabel.value}?`)
    case 'reactivate':
      return t(`Reactivate ${patientsLabel.value}?`, `¿Reactivar ${patientsLabel.value}?`)
    case 'practitioner':
      return t(`Practitioner for ${patientsLabel.value}`, `Profesional para ${patientsLabel.value}`)
    default:
      return t(`Tags for ${patientsLabel.value}`, `Etiquetas para ${patientsLabel.value}`)
  }
})
const confirmLabel = computed(() => {
  switch (props.kind) {
    case 'archive':
      return t('Archive', 'Archivar')
    case 'reactivate':
      return t('Reactivate', 'Reactivar')
    case 'practitioner':
      return t('Assign', 'Asignar')
    default:
      return tagMode.value === 'add' ? t('Add the tag', 'Añadir la etiqueta') : t('Remove the tag', 'Quitar la etiqueta')
  }
})

type BulkChange = { status: 'active' | 'inactive' } | { practitioner_id: string | null } | { add_tag: string } | { remove_tag: string }
const changes = computed<BulkChange | null>(() => {
  switch (props.kind) {
    case 'archive':
      return { status: 'inactive' }
    case 'reactivate':
      return { status: 'active' }
    case 'practitioner':
      if (!practitioner.value) return null
      return { practitioner_id: practitioner.value === NONE ? null : practitioner.value }
    default: {
      const tag = (tagMode.value === 'add' ? tagInput.value : tagToRemove.value).trim()
      if (!tag) return null
      return tagMode.value === 'add' ? { add_tag: tag } : { remove_tag: tag }
    }
  }
})

function doneSummary(r: { matched: number; changed: number; skipped: number }) {
  const n = r.changed
  const first = (() => {
    switch (props.kind) {
      case 'archive':
        return n === 1 ? t('1 patient archived', '1 paciente archivado') : t(`${n} patients archived`, `${n} pacientes archivados`)
      case 'reactivate':
        return n === 1 ? t('1 patient reactivated', '1 paciente reactivado') : t(`${n} patients reactivated`, `${n} pacientes reactivados`)
      case 'practitioner':
        return t(`Practitioner changed for ${patientsN(n)}`, `Profesional cambiado a ${patientsN(n)}`)
      default:
        return tagMode.value === 'add'
          ? t(`Tag added to ${patientsN(n)}`, `Etiqueta añadida a ${patientsN(n)}`)
          : t(`Tag removed from ${patientsN(n)}`, `Etiqueta quitada a ${patientsN(n)}`)
    }
  })()
  const parts = [first]
  const already = r.matched - r.changed - r.skipped
  if (already > 0) parts.push(t(`${already} already were`, `${already} ya lo estaban`))
  if (r.skipped > 0) parts.push(t(`${r.skipped} you cannot change`, `${r.skipped} que no puedes cambiar`))
  return parts.join(' · ')
}

async function confirm() {
  if (!changes.value || busy.value || !store.accountId) return
  busy.value = true
  error.value = ''
  const ids = 'patientIds' in props.selection ? props.selection.patientIds : null
  const { data, error: err } = await supabase.rpc('bulk_update_patients', {
    p_account_id: store.accountId,
    p_patient_ids: ids as string[],
    p_filters: ('filters' in props.selection ? props.selection.filters : null) as Json,
    p_clinic_id: ('clinicId' in props.selection ? props.selection.clinicId : null) as string,
    p_changes: changes.value as Json,
  })
  busy.value = false
  if (err || !data) {
    if (err?.message?.includes('cannot remove patient tags')) {
      error.value = t('Your role cannot remove tags. Nothing was changed.', 'Tu rol no puede quitar etiquetas. No se ha cambiado nada.')
    } else if (err?.message?.startsWith('Too many patients')) {
      error.value = t('Too many patients at once. Narrow the filter (5000 at most).', 'Demasiados pacientes a la vez. Acota el filtro (5000 como máximo).')
    } else if (err?.code === '42501') {
      error.value = t('Your role cannot make this change. Nothing was changed.', 'Tu rol no puede hacer este cambio. No se ha cambiado nada.')
    } else {
      error.value = t('The patients could not be changed. Nothing was changed.', 'No se han podido cambiar los pacientes. No se ha cambiado nada.')
    }
    return
  }
  emit('done', doneSummary(data as { matched: number; changed: number; skipped: number }))
}
</script>

<template>
  <UiConfirmDialog
    :title="title"
    :confirm-label="confirmLabel"
    :cancel-label="t('Cancel', 'Cancelar')"
    :disabled="!changes"
    :busy="busy"
    @confirm="confirm"
    @cancel="emit('cancel')"
  >
    <p v-if="kind === 'archive'" class="text-[13px] text-ink-muted">
      {{ t(
        'They leave the default patient list and stop receiving campaigns and automations. Their history, appointments and invoices stay, and you can reactivate them at any time.',
        'Salen de la lista de pacientes por defecto y dejan de recibir campañas y automatizaciones. Su historial, citas y facturas se quedan, y puedes reactivarlos cuando quieras.',
      ) }}
    </p>
    <p v-else-if="kind === 'reactivate'" class="text-[13px] text-ink-muted">
      {{ t(
        'They return to the default patient list, and to the campaigns and automations they qualify for.',
        'Vuelven a la lista de pacientes por defecto, y a las campañas y automatizaciones que les correspondan.',
      ) }}
    </p>

    <label v-else-if="kind === 'practitioner'" :for="`${fieldId}-practitioner`" class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
      {{ t('Practitioner', 'Profesional') }}
      <select
        :id="`${fieldId}-practitioner`"
        v-model="practitioner"
        data-cy="bulk-edit-practitioner"
        class="h-9 rounded-ctl border border-line-control bg-surface px-2 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
      >
        <option value="" disabled>{{ t('Choose…', 'Elige…') }}</option>
        <option v-for="m in practitioners" :key="m.id" :value="m.id">{{ m.full_name }}</option>
        <option :value="NONE">{{ t('No practitioner', 'Sin profesional') }}</option>
      </select>
    </label>

    <template v-else>
      <!-- Removing any tag needs patients_tags_remove (the trigger in
      20260925094121_roles_tags_any_and_front_desk_bonos.sql); a role without
      it is not offered the choice, as the record's form does not. -->
      <div v-if="canRemoveTags" class="flex gap-1" role="group" :aria-label="t('Add or remove', 'Añadir o quitar')">
        <button
          v-for="m in (['add', 'remove'] as const)"
          :key="m"
          type="button"
          :aria-pressed="tagMode === m"
          class="h-9 rounded-ctl border px-3 text-[13px] font-medium touch:h-11"
          :class="tagMode === m ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
          :data-cy="`bulk-edit-tag-mode-${m}`"
          @click="tagMode = m"
        >
          {{ m === 'add' ? t('Add', 'Añadir') : t('Remove', 'Quitar') }}
        </button>
      </div>
      <template v-if="tagMode === 'add'">
        <label :for="`${fieldId}-tag`" class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Tag', 'Etiqueta') }}
          <input
            :id="`${fieldId}-tag`"
            v-model="tagInput"
            maxlength="60"
            autocomplete="off"
            data-cy="bulk-edit-tag-input"
            :placeholder="t('Type or pick a tag', 'Escribe o elige una etiqueta')"
            class="h-9 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
            @keydown.enter.prevent="confirm"
          />
        </label>
        <!-- The clinic's tags as buttons rather than a <datalist>: its native
        dropdown takes headless Electron down with a segfault (exit 139) the
        moment Cypress types into the field, and the chips are what the
        tag filter already looks like. -->
        <div v-if="tagSuggestions.length" class="flex flex-wrap gap-1.5">
          <button
            v-for="tag in tagSuggestions"
            :key="tag"
            type="button"
            data-cy="bulk-edit-tag-suggestion"
            :aria-pressed="tag === tagInput.trim()"
            class="h-7 rounded-pill border px-2.5 text-[12px] font-medium outline-none focus-visible:shadow-focus touch:h-11"
            :class="tag === tagInput.trim() ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
            @click="tagInput = tag"
          >
            {{ tag }}
          </button>
        </div>
      </template>
      <template v-else>
        <label v-if="knownTags.length" :for="`${fieldId}-remove`" class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Tag', 'Etiqueta') }}
          <select
            :id="`${fieldId}-remove`"
            v-model="tagToRemove"
            data-cy="bulk-edit-tag-remove"
            class="h-9 rounded-ctl border border-line-control bg-surface px-2 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand touch:h-11"
          >
            <option v-for="tag in knownTags" :key="tag" :value="tag">{{ tag }}</option>
          </select>
        </label>
        <p v-else class="text-[13px] text-ink-muted">{{ t('No patient has a tag yet.', 'Ningún paciente tiene etiquetas todavía.') }}</p>
      </template>
    </template>

    <p v-if="error" role="alert" data-cy="bulk-edit-error" class="text-[12.5px] font-semibold text-danger-text">{{ error }}</p>
  </UiConfirmDialog>
</template>
