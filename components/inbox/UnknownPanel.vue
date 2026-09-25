<script setup lang="ts">
import { splitDialPrefix } from '~/utils/phone'
import { normalizeSearchTerm } from '~/utils/searchText'

// Beside a thread from a number no patient has: attach it to one. Linking
// (link_inbox_conversation) moves every message from this number onto the
// patient, so it becomes their one thread rather than a second one beside it.
const props = defineProps<{ phoneNumber: string }>()
const emit = defineEmits<{ linked: [patientId: string] }>()
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface Candidate {
  id: string
  first_name: string
  last_name: string | null
}
const suggestions = ref<Candidate[]>([])
const query = ref('')
const results = ref<Candidate[]>([])
const busy = ref(false)

// Patients with the same number stored in another format (+34 or not,
// spaces): matched on the last nine digits.
onMounted(async () => {
  const digits = props.phoneNumber.replace(/\D/g, '').slice(-9)
  if (digits.length < 6) return
  const { data } = await supabase.from('patient_contact_numbers').select('patient_id, patients(id, first_name, last_name)').ilike('number', `%${digits}%`).limit(3)
  suggestions.value = ((data ?? []) as any[]).map((r) => r.patients).filter(Boolean)
})

let timer: ReturnType<typeof setTimeout> | undefined
watch(query, (q) => {
  clearTimeout(timer)
  if (!q.trim()) {
    results.value = []
    return
  }
  timer = setTimeout(async () => {
    const { data } = await supabase.from('patients').select('id, first_name, last_name').ilike('search_name', `%${normalizeSearchTerm(q.trim())}%`).order('first_name').limit(8)
    results.value = data ?? []
  }, 250)
})

async function link(patientId: string) {
  busy.value = true
  const { error } = await supabase.rpc('link_inbox_conversation', { p_phone_number: props.phoneNumber, p_patient_id: patientId })
  busy.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(t('Linked. The conversation is now on the patient.', 'Vinculado. La conversación ya está en su ficha.'))
  emit('linked', patientId)
}

// A new patient with just a name and this number, then linked.
const creating = ref(false)
const firstName = ref('')
const lastName = ref('')
async function createAndLink() {
  if (!firstName.value.trim() || !store.accountId) return
  busy.value = true
  const { data: patient, error } = await supabase
    .from('patients')
    .insert({ account_id: store.accountId, clinic_id: store.currentClinicId, first_name: firstName.value.trim(), last_name: lastName.value.trim() || null })
    .select('id')
    .single()
  if (error || !patient) {
    busy.value = false
    showToast(error?.message ?? t('Could not create the patient.', 'No se pudo crear el paciente.'), 'error')
    return
  }
  const { countryCode, number } = splitDialPrefix(props.phoneNumber, store.defaultPhoneCountry)
  await supabase.from('patient_contact_numbers').insert({ account_id: store.accountId, patient_id: patient.id, country_code: countryCode, number, is_whatsapp: true })
  await link(patient.id)
}
</script>

<template>
  <aside :aria-label="t('Number without a patient', 'Número sin paciente')" class="w-[300px] shrink-0 flex-col 2xl:w-[340px] gap-3 overflow-y-auto border-l border-line bg-surface-subtle p-4" data-cy="inbox-unknown-panel">
    <div class="flex flex-col gap-1">
      <strong class="text-[16px] text-ink-900">{{ t('Number without a patient', 'Número sin paciente') }}</strong>
      <span class="text-[13.5px] leading-snug text-ink-500">{{ t(`${phoneNumber} matches no patient. Link it and the conversation moves to their record, with everything written so far.`, `${phoneNumber} no coincide con ningún paciente. Vincúlalo y la conversación pasa a su ficha, con todo lo escrito hasta ahora.`) }}</span>
    </div>
    <div v-if="suggestions.length" class="flex flex-col gap-1 rounded-card border border-line bg-surface p-3">
      <span class="text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted">{{ t('Maybe it is', 'Quizá es') }}</span>
      <button v-for="c in suggestions" :key="c.id" type="button" data-cy="unknown-suggestion" class="flex min-h-9 touch:min-h-11 items-center gap-2 rounded-ctlSm px-2 text-left text-[14px] text-ink-900 hover:bg-surface-subtle disabled:opacity-60" :disabled="busy" @click="link(c.id)">
        <span class="flex-1 font-semibold">{{ c.first_name }} {{ c.last_name ?? '' }}</span>
        <span class="text-[13px] font-semibold text-brand-text">{{ t('Link', 'Vincular') }}</span>
      </button>
    </div>
    <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
      {{ t('Link to a patient', 'Vincular a un paciente') }}
      <input
        v-model="query"
        type="search"
        data-cy="unknown-search"
        :placeholder="t('Name or surname', 'Nombre o apellidos')"
        class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none"
      />
    </label>
    <div v-if="results.length" class="flex flex-col rounded-card border border-line bg-surface p-1">
      <button v-for="c in results" :key="c.id" type="button" data-cy="unknown-result" class="flex min-h-9 touch:min-h-11 items-center gap-2 rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle disabled:opacity-60" :disabled="busy" @click="link(c.id)">
        <span class="flex-1">{{ c.first_name }} {{ c.last_name ?? '' }}</span>
        <span class="text-[13px] font-semibold text-brand-text">{{ t('Link', 'Vincular') }}</span>
      </button>
    </div>
    <button v-if="!creating" type="button" data-cy="unknown-create" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="creating = true">
      {{ t('Create patient with this number', 'Crear paciente con este número') }}
    </button>
    <form v-else class="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3" @submit.prevent="createAndLink">
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('First name', 'Nombre') }}
        <input v-model="firstName" data-cy="unknown-first-name" type="text" required class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none" />
      </label>
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('Surname', 'Apellidos') }}
        <input v-model="lastName" data-cy="unknown-last-name" type="text" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none" />
      </label>
      <div class="flex gap-2">
        <button type="button" class="h-9 touch:h-11 flex-1 rounded-ctl border border-line-control bg-surface text-[14px] font-semibold text-ink-700" @click="creating = false">{{ t('Cancel', 'Cancelar') }}</button>
        <button type="submit" data-cy="unknown-create-submit" class="h-9 touch:h-11 flex-1 rounded-ctl bg-brand text-[14px] font-bold text-surface disabled:opacity-60" :disabled="busy || !firstName.trim()">{{ t('Create and link', 'Crear y vincular') }}</button>
      </div>
    </form>
  </aside>
</template>
