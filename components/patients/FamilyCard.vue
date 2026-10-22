<script setup lang="ts">
import { FAMILY_RELATIONS, inverseRelation, relationLabel, type FamilyRelation } from '~/utils/familyRelations'
import { patientAge } from '~/utils/patientAge'
import { normalizeSearchTerm } from '~/utils/searchText'

// "Familia" on a patient's record: the people in their family who are
// patients too, each a link to their own record -- the mother who brings the
// two children, the couple who come on the same afternoon. Added and removed
// here, saved at once, both ways (utils/familyRelations.ts). The tutor of a
// minor stays where it was (Datos del paciente): that one decides who hears
// about the visits, this one only says who is who.

interface Person { id: string; first_name: string; last_name: string | null; gender: string | null; date_of_birth: string | null }
interface Link { id: string; related_patient_id: string; relation: FamilyRelation; related: Person | null }

const props = defineProps<{ patient: { id: string; account_id: string; first_name: string } }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { can } = usePermission()
const { showToast } = useToast()

const links = ref<Link[]>([])
const loading = ref(true)
async function load() {
  const { data } = await supabase
    .from('patient_relations')
    .select('id, related_patient_id, relation, related:patients!patient_relations_related_patient_id_fkey(id, first_name, last_name, gender, date_of_birth)')
    .eq('patient_id', props.patient.id)
    .order('created_at')
  links.value = (data as unknown as Link[] | null) ?? []
  loading.value = false
}
onMounted(load)
watch(() => props.patient.id, load)

const nameOf = (p: Person | null) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim() || t('Patient', 'Paciente')

// Adding: find the person, say what they are to this patient.
const adding = ref(false)
const search = ref('')
const results = ref<Person[]>([])
const picked = ref<Person | null>(null)
const relation = ref<FamilyRelation>('parent')
const saving = ref(false)
let debounce: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(debounce)
  if (!value.trim()) {
    results.value = []
    return
  }
  debounce = setTimeout(async () => {
    const taken = new Set([props.patient.id, ...links.value.map((l) => l.related_patient_id)])
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name, gender, date_of_birth')
      .ilike('search_name', `%${normalizeSearchTerm(value.trim())}%`)
      .limit(10)
    results.value = ((data as Person[] | null) ?? []).filter((p) => !taken.has(p.id)).slice(0, 8)
  }, 250)
})
function closeAdd() {
  adding.value = false
  search.value = ''
  results.value = []
  picked.value = null
  relation.value = 'parent'
}
async function add() {
  if (!picked.value || saving.value) return
  saving.value = true
  const other = picked.value.id
  const createdBy = store.teamMember?.id ?? null
  const { error } = await supabase.from('patient_relations').insert([
    { account_id: props.patient.account_id, patient_id: props.patient.id, related_patient_id: other, relation: relation.value, created_by: createdBy },
    { account_id: props.patient.account_id, patient_id: other, related_patient_id: props.patient.id, relation: inverseRelation(relation.value), created_by: createdBy },
  ])
  saving.value = false
  if (error) {
    showToast(t('The family link could not be saved.', 'No se ha podido guardar el familiar.'), 'error')
    return
  }
  closeAdd()
  await load()
}
async function remove(link: Link) {
  const { error } = await supabase
    .from('patient_relations')
    .delete()
    .or(`and(patient_id.eq.${props.patient.id},related_patient_id.eq.${link.related_patient_id}),and(patient_id.eq.${link.related_patient_id},related_patient_id.eq.${props.patient.id})`)
  if (error) {
    showToast(t('The family link could not be removed.', 'No se ha podido quitar el familiar.'), 'error')
    return
  }
  links.value = links.value.filter((l) => l.id !== link.id)
}
</script>

<template>
  <section aria-labelledby="ov-family" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-family">
    <div class="flex items-center justify-between gap-2">
      <h2 id="ov-family" class="text-[13.5px] font-semibold text-ink-700">{{ t('Family', 'Familia') }}</h2>
      <button v-if="can('patients_edit') && !adding" type="button" class="text-[12.5px] font-medium text-brand-text outline-none hover:underline focus-visible:shadow-focus" data-cy="family-add" @click="adding = true">
        {{ t('Add', 'Añadir') }}
      </button>
    </div>

    <UiSkeleton v-if="loading" class="mt-3 h-4 w-40 rounded-ctlSm" />
    <ul v-else-if="links.length" class="mt-2.5 space-y-1.5">
      <li v-for="l in links" :key="l.id" class="flex items-center gap-2 text-[13.5px]" data-cy="family-link">
        <span class="w-24 shrink-0 text-[12px] text-ink-muted2">{{ relationLabel(l.relation, l.related?.gender, t) }}</span>
        <NuxtLink :to="`/patients/${l.related_patient_id}`" class="min-w-0 flex-1 truncate text-brand-text hover:underline">{{ nameOf(l.related) }}</NuxtLink>
        <span v-if="patientAge(l.related?.date_of_birth) !== null" class="shrink-0 text-[12px] text-ink-muted">{{ t(`${patientAge(l.related?.date_of_birth)} y`, `${patientAge(l.related?.date_of_birth)} años`) }}</span>
        <button
          v-if="can('patients_edit')"
          type="button"
          class="-m-1 shrink-0 p-1 text-ink-faint hover:text-danger-text touch:p-2"
          :aria-label="t(`Remove ${nameOf(l.related)} from the family`, `Quitar a ${nameOf(l.related)} de la familia`)"
          data-cy="family-remove"
          @click="remove(l)"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </li>
    </ul>
    <p v-else-if="!adding" class="mt-2.5 text-[13px] text-ink-faint">{{ t('No family members linked.', 'Ningún familiar vinculado.') }}</p>

    <form v-if="adding" class="mt-3 space-y-2 border-t border-line-divider pt-3" data-cy="family-form" @submit.prevent="add">
      <div v-if="picked" class="flex items-center gap-2 text-[13.5px]">
        <span class="min-w-0 flex-1 truncate text-ink-900">{{ nameOf(picked) }}</span>
        <button type="button" class="text-[12px] text-ink-muted hover:underline" @click="picked = null">{{ t('Change', 'Cambiar') }}</button>
      </div>
      <div v-else class="relative">
        <input
          v-model="search"
          type="text"
          :placeholder="t('Search patient by name…', 'Buscar paciente por nombre…')"
          class="h-9 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-11"
          data-cy="family-search"
        />
        <ul v-if="results.length" class="absolute z-10 mt-1 w-full rounded-ctl border border-line bg-surface py-1 shadow-popover">
          <li v-for="p in results" :key="p.id">
            <button type="button" class="block w-full px-3 py-1.5 text-left text-[13px] text-ink-700 hover:bg-surface-subtle" data-cy="family-result" @click="picked = p; results = []">{{ nameOf(p) }}</button>
          </li>
        </ul>
      </div>
      <label class="block text-[12px] text-ink-muted2">
        {{ picked ? t(`${picked.first_name} is ${patient.first_name}'s…`, `${picked.first_name} es … de ${patient.first_name}`) : t('Relation', 'Relación') }}
        <select v-model="relation" class="mt-1 h-9 w-full rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-11" data-cy="family-relation">
          <option v-for="r in FAMILY_RELATIONS" :key="r" :value="r">{{ relationLabel(r, picked?.gender, t) }}</option>
        </select>
      </label>
      <div class="flex justify-end gap-2">
        <UiBtn variant="secondary" size="sm" @click="closeAdd">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <UiBtn variant="primary" size="sm" :disabled="!picked || saving" data-cy="family-save" @click="add">{{ saving ? t('Saving…', 'Guardando…') : t('Add', 'Añadir') }}</UiBtn>
      </div>
    </form>
  </section>
</template>
