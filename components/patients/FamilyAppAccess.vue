<script setup lang="ts">
import { patientAge } from '~/utils/patientAge'
import type { FamilyRelation } from '~/utils/familyRelations'

// "Acceso en la app" under one family link on the ficha: whether one of the
// two may manage the other's account from their own login -- book, pay,
// check in and, on a full link, see documents and exercises
// (patient_managers, 20261106053857_family_accounts.sql).
//
// Never assumed from the family link itself: a sibling or an adult child must
// not read another adult's record. The direction follows the relation (a
// parent manages a child); between partners, siblings or "other" the desk
// says which way. A minor under 16 can be managed by a parent or guardian;
// from 16, and for any adult, only with their consent, written down here.
interface Person { id: string; first_name: string; last_name: string | null; date_of_birth: string | null; is_minor?: boolean | null; user_id?: string | null }
interface ManagerLink { id: string; manager_patient_id: string; patient_id: string; basis: 'guardian' | 'consent'; access: 'full' | 'admin'; note: string | null }

const props = defineProps<{
  accountId: string
  self: Person
  related: Person
  relation: FamilyRelation
  links: ManagerLink[]
}>()
const emit = defineEmits<{ changed: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { can } = usePermission()
const { showToast } = useToast()

type Dir = 'in' | 'out' // in: related manages self; out: self manages related
const pair = (d: Dir) => (d === 'in' ? { manager: props.related, managed: props.self } : { manager: props.self, managed: props.related })
const isAdult = (p: Person) => !p.is_minor && (patientAge(p.date_of_birth) ?? 18) >= 18
const guardianAge = (p: Person) => {
  const age = patientAge(p.date_of_birth)
  return age !== null ? age < 16 : Boolean(p.is_minor)
}

const dirs = computed<Dir[]>(() => {
  const possible: Dir[] = props.relation === 'child' ? ['out'] : props.relation === 'parent' ? ['in'] : ['in', 'out']
  return possible.filter((d) => isAdult(pair(d).manager))
})
const existing = computed(() =>
  dirs.value.flatMap((d) => {
    const { manager, managed } = pair(d)
    const link = props.links.find((l) => l.manager_patient_id === manager.id && l.patient_id === managed.id)
    return link ? [{ dir: d, link, manager, managed }] : []
  }),
)
const free = computed(() => dirs.value.filter((d) => !existing.value.some((e) => e.dir === d)))

const nameOf = (p: Person) => `${p.first_name} ${p.last_name ?? ''}`.trim()

// The form
const open = ref(false)
const dir = ref<Dir>('out')
const basis = ref<'guardian' | 'consent'>('consent')
const access = ref<'full' | 'admin'>('admin')
const note = ref('')
const saving = ref(false)
const canGuardian = computed(() => guardianAge(pair(dir.value).managed))
function start() {
  dir.value = free.value[0] ?? 'out'
  resetFor()
  open.value = true
}
function resetFor() {
  basis.value = canGuardian.value ? 'guardian' : 'consent'
  access.value = basis.value === 'guardian' ? 'full' : 'admin'
  note.value = ''
}
watch(dir, resetFor)
const canSave = computed(() => !saving.value && (basis.value === 'guardian' || note.value.trim().length > 2))

async function save() {
  if (!canSave.value) return
  saving.value = true
  const { manager, managed } = pair(dir.value)
  const { error } = await supabase.from('patient_managers').insert({
    account_id: props.accountId,
    manager_patient_id: manager.id,
    patient_id: managed.id,
    basis: basis.value,
    access: access.value,
    note: note.value.trim() || null,
    granted_by: store.teamMember?.id ?? null,
  })
  saving.value = false
  if (error) {
    // The trigger's own words are Spanish and meant for the desk.
    showToast(error.message.includes('16') || error.message.includes('mayor') ? error.message : t('App access could not be saved.', 'No se ha podido guardar el acceso en la app.'), 'error')
    return
  }
  open.value = false
  emit('changed')
}

async function revoke(id: string) {
  const { error } = await supabase.from('patient_managers').delete().eq('id', id)
  if (error) {
    showToast(t('App access could not be removed.', 'No se ha podido quitar el acceso en la app.'), 'error')
    return
  }
  emit('changed')
}

const accessWord = (a: string) => (a === 'admin' ? t('visits and payments', 'citas y pagos') : t('everything', 'todo'))
const basisWord = (b: string) => (b === 'guardian' ? t('guardian', 'tutor/a') : t('with consent', 'con consentimiento'))
</script>

<template>
  <div v-if="existing.length || (free.length && can('patients_edit'))" class="ml-[6.5rem] mt-0.5 space-y-1" data-cy="family-app-access">
    <p v-for="e in existing" :key="e.link.id" class="flex items-center gap-2 text-[12px] text-ink-muted" data-cy="family-app-access-link">
      <svg class="shrink-0 text-info-text" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="1.5" width="8" height="13" rx="1.6" /><path d="M7 12.2h2" stroke-linecap="round" /></svg>
      <span class="min-w-0 flex-1 truncate">
        {{ t(`${e.manager.first_name} manages ${e.managed.first_name}'s app`, `${e.manager.first_name} gestiona la app de ${e.managed.first_name}`) }}
        · {{ basisWord(e.link.basis) }} · {{ accessWord(e.link.access) }}
        <template v-if="!e.manager.user_id"> · {{ t('no app yet', 'aún sin app') }}</template>
      </span>
      <button v-if="can('patients_edit')" type="button" class="shrink-0 text-[12px] text-ink-muted hover:text-danger-text hover:underline" data-cy="family-app-access-remove" @click="revoke(e.link.id)">
        {{ t('Remove', 'Quitar') }}
      </button>
    </p>
    <button v-if="free.length && can('patients_edit') && !open" type="button" class="text-[12px] font-medium text-brand-text hover:underline" data-cy="family-app-access-add" @click="start">
      {{ t('App access…', 'Acceso en la app…') }}
    </button>

    <form v-if="open" class="space-y-2 rounded-ctl border border-line-divider bg-surface-subtle p-2.5" data-cy="family-app-access-form" @submit.prevent="save">
      <label v-if="free.length > 1" class="block text-[12px] text-ink-muted2">
        {{ t('Who manages whom', 'Quién gestiona a quién') }}
        <select v-model="dir" class="mt-1 h-9 w-full rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-11">
          <option v-for="d in free" :key="d" :value="d">{{ t(`${pair(d).manager.first_name} manages ${pair(d).managed.first_name}`, `${pair(d).manager.first_name} gestiona a ${pair(d).managed.first_name}`) }}</option>
        </select>
      </label>
      <p v-else class="text-[12.5px] text-ink-700">
        {{ t(`${pair(dir).manager.first_name} will manage ${nameOf(pair(dir).managed)}'s account from their own app or portal.`, `${pair(dir).manager.first_name} gestionará la cuenta de ${nameOf(pair(dir).managed)} desde su propia app o portal.`) }}
      </p>

      <fieldset class="space-y-1">
        <legend class="text-[12px] text-ink-muted2">{{ t('On what basis', 'Con qué base') }}</legend>
        <label v-if="canGuardian" class="flex items-center gap-2 text-[13px] text-ink-700">
          <input v-model="basis" type="radio" value="guardian" data-cy="family-app-basis-guardian" />
          {{ t('Parent or legal guardian (under 16)', 'Padre, madre o tutor legal (menor de 16)') }}
        </label>
        <label class="flex items-center gap-2 text-[13px] text-ink-700">
          <input v-model="basis" type="radio" value="consent" data-cy="family-app-basis-consent" />
          {{ t(`${pair(dir).managed.first_name} has agreed`, `${pair(dir).managed.first_name} ha dado su consentimiento`) }}
        </label>
      </fieldset>
      <input
        v-if="basis === 'consent'"
        v-model="note"
        type="text"
        maxlength="300"
        :placeholder="t('How and when they agreed (e.g. signed at the desk, 6 Nov)', 'Cómo y cuándo lo autorizó (p. ej. firmado en recepción el 6/11)')"
        class="h-9 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-11"
        data-cy="family-app-note"
      />

      <fieldset class="space-y-1">
        <legend class="text-[12px] text-ink-muted2">{{ t('What they can see', 'Qué puede ver') }}</legend>
        <label class="flex items-center gap-2 text-[13px] text-ink-700">
          <input v-model="access" type="radio" value="admin" data-cy="family-app-access-admin" />
          {{ t('Visits, bookings and payments', 'Citas, reservas y pagos') }}
        </label>
        <label class="flex items-center gap-2 text-[13px] text-ink-700">
          <input v-model="access" type="radio" value="full" data-cy="family-app-access-full" />
          {{ t('Everything, including documents, exercises and messages', 'Todo, también documentos, ejercicios y mensajes') }}
        </label>
      </fieldset>

      <div class="flex justify-end gap-2">
        <UiBtn variant="secondary" size="sm" @click="open = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <UiBtn variant="primary" size="sm" :disabled="!canSave" data-cy="family-app-access-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Give access', 'Dar acceso') }}</UiBtn>
      </div>
    </form>
  </div>
</template>
