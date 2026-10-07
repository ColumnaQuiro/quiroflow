<script setup lang="ts">
// A thread from a number no patient has, attached to one -- the web's
// UnknownPanel (components/inbox/UnknownPanel.vue), step for step:
// link_inbox_conversation moves every message from the number onto the
// patient, so it becomes their one thread; then the number is stored on the
// patient (as a patient stores it), or their next WhatsApp arrives as a
// stranger again. Patients with the same number stored another way are
// suggested; any patient can be searched; or a new one made with just a name.
import { leadPhoneAsContactNumber, phoneMatches, whatsappDigits } from '../../utils/phone'
import { normalizeSearchTerm, sanitizeSearchToken } from '../../utils/searchText'

const props = defineProps<{ phoneNumber: string }>()
const emit = defineEmits<{ linked: [patientId: string]; close: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const { context } = usePractitionerContext()

interface Candidate { id: string; first_name: string; last_name: string | null }
const suggestions = ref<Candidate[]>([])
const query = ref('')
const results = ref<Candidate[]>([])
const busy = ref(false)
const error = ref('')
const defaultCountry = ref('ES')

onMounted(async () => {
  const digits = props.phoneNumber.replace(/\D/g, '').slice(-9)
  const [sugg, acct] = await Promise.all([
    digits.length >= 6 ? supabase.from('patient_contact_numbers').select('patient_id, patients(id, first_name, last_name)').ilike('number', `%${digits}%`).limit(3) : Promise.resolve({ data: [] }),
    context.value ? supabase.from('accounts').select('default_phone_country').eq('id', context.value.accountId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  suggestions.value = (((sugg.data as unknown as { patients: Candidate | null }[]) ?? []).map((r) => r.patients).filter(Boolean) as Candidate[])
  defaultCountry.value = (acct.data as { default_phone_country: string | null } | null)?.default_phone_country || 'ES'
})

let timer: ReturnType<typeof setTimeout> | undefined
let searchRun = 0
watch(query, (q) => {
  clearTimeout(timer)
  if (!q.trim()) {
    results.value = []
    return
  }
  timer = setTimeout(async () => {
    const mine = ++searchRun
    let s = supabase.from('patients').select('id, first_name, last_name')
    for (const w of q.trim().split(/\s+/).map(sanitizeSearchToken).filter(Boolean)) s = s.ilike('search_name', `%${normalizeSearchTerm(w)}%`)
    const { data } = await s.order('first_name').limit(8)
    if (mine === searchRun) results.value = (data as Candidate[] | null) ?? []
  }, 250)
})

async function rememberNumberOn(patientId: string): Promise<boolean> {
  const contact = leadPhoneAsContactNumber(props.phoneNumber, defaultCountry.value)
  if (!contact || !context.value) return false
  const digits = whatsappDigits(props.phoneNumber)
  const { data: existing } = await supabase.from('patient_contact_numbers').select('number, country_code').eq('patient_id', patientId)
  if (((existing as { number: string; country_code: string }[] | null) ?? []).some((n) => phoneMatches(n.number, n.country_code, digits))) return true
  const { error: e } = await supabase.from('patient_contact_numbers').insert({ account_id: context.value.accountId, patient_id: patientId, country_code: contact.countryCode, number: contact.number, is_whatsapp: true } as never)
  return !e
}

async function link(patientId: string) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.rpc('link_inbox_conversation' as never, { p_phone_number: props.phoneNumber, p_patient_id: patientId } as never)
  if (e) {
    busy.value = false
    error.value = e.message
    return
  }
  const remembered = await rememberNumberOn(patientId)
  busy.value = false
  if (!remembered) {
    error.value = t('Linked, but the number could not be added to the patient: add it on their record so their next message finds them.', 'Vinculado, pero no se pudo añadir el número al paciente: añádelo en su ficha para que su próximo mensaje le encuentre.')
  }
  emit('linked', patientId)
}

const creating = ref(false)
const firstName = ref('')
const lastName = ref('')
async function createAndLink() {
  if (!firstName.value.trim() || !context.value || busy.value) return
  busy.value = true
  error.value = ''
  const id = crypto.randomUUID()
  const own = context.value.permissions.patients_scope === 'own'
  const { error: e } = await supabase.from('patients').insert({
    id,
    account_id: context.value.accountId,
    clinic_id: context.value.clinicId,
    first_name: firstName.value.trim(),
    last_name: lastName.value.trim() || null,
    // Someone who sees only their own patients could not see a patient who
    // is nobody's, as on the web.
    default_practitioner_id: own ? context.value.teamMemberId : null,
  } as never)
  busy.value = false
  if (e) {
    error.value = e.message
    return
  }
  await link(id)
}
const nameOf = (c: Candidate) => `${c.first_name} ${c.last_name ?? ''}`.trim()
const field = 'h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none'
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="inbox-link-sheet" @click.self="emit('close')">
    <div class="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[440px] md:rounded-[18px] md:pt-5" style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)" role="dialog" aria-modal="true" :aria-label="t('Link to a patient', 'Vincular a un paciente')">
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
      <div>
        <p class="text-[17px] font-semibold text-ink-900">{{ t('Link to a patient', 'Vincular a un paciente') }}</p>
        <p class="mt-0.5 text-[12.5px] leading-snug text-ink-muted">{{ t(`The conversation with ${phoneNumber} moves onto the patient, and the number is saved on their record.`, `La conversación con ${phoneNumber} pasa a su ficha y el número se guarda en ella.`) }}</p>
      </div>

      <div v-if="suggestions.length" class="flex flex-col gap-1.5">
        <p class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Same number', 'Mismo número') }}</p>
        <button v-for="c in suggestions" :key="c.id" type="button" class="flex min-h-11 items-center justify-between rounded-ctl border-[1.5px] border-brand bg-brand-tint px-3 text-left text-[14.5px] font-semibold text-ink-900 disabled:opacity-50" :disabled="busy" data-cy="inbox-link-suggestion" @click="link(c.id)">
          {{ nameOf(c) }}<span class="text-[12.5px] font-semibold text-brand-text">{{ t('Link', 'Vincular') }}</span>
        </button>
      </div>

      <template v-if="!creating">
        <input v-model="query" type="search" autocomplete="off" :placeholder="t('Search a patient…', 'Busca un paciente…')" :class="field" data-cy="inbox-link-search" />
        <div v-if="query.trim()" class="max-h-56 divide-y divide-line-row overflow-y-auto rounded-ctl border border-line">
          <button v-for="c in results" :key="c.id" type="button" class="flex min-h-11 w-full items-center px-3 text-left text-[14.5px] text-ink-900 disabled:opacity-50" :disabled="busy" data-cy="inbox-link-result" @click="link(c.id)">{{ nameOf(c) }}</button>
          <p v-if="!results.length" class="px-3 py-2.5 text-[13px] text-ink-faint">{{ t('No matches', 'Sin resultados') }}</p>
        </div>
        <button type="button" class="self-start text-[13.5px] font-semibold text-brand-text" data-cy="inbox-link-new" @click="creating = true">{{ t('+ New patient with this number', '+ Paciente nuevo con este número') }}</button>
      </template>
      <form v-else class="flex flex-col gap-2" @submit.prevent="createAndLink">
        <div class="grid grid-cols-2 gap-2">
          <input v-model="firstName" type="text" :placeholder="t('First name', 'Nombre')" :class="field" data-cy="inbox-link-first" />
          <input v-model="lastName" type="text" :placeholder="t('Surname', 'Apellidos')" :class="field" />
        </div>
        <button type="submit" class="flex h-11 items-center justify-center rounded-card bg-brand text-[15px] font-semibold text-white disabled:opacity-50" :disabled="busy || !firstName.trim()" data-cy="inbox-link-create">{{ busy ? t('Saving…', 'Guardando…') : t('Create and link', 'Crear y vincular') }}</button>
      </form>

      <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
      <button type="button" class="flex min-h-11 items-center justify-center text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
    </div>
  </div>
</template>
