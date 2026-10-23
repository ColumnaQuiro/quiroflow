<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { chargeOutstandingCents, coverWarnings, coverWarningText } from '~/utils/thirdParties'

// The insurers, medico-legal cases and companies a patient is covered by --
// their policy or case number and what was authorised -- and what each one
// still owes for this patient's visits (20261023093754).
//
// That figure is the third party's debt, not the patient's: it sits here,
// beside the patient's own "Owed now", and never inside it.
//
// Nothing renders on an account with no third parties and a patient with no
// cover, so a clinic that bills nobody but its patients sees no new box.
const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const { can } = usePermission()
const t = useT()
const { showToast } = useToast()

interface Cover {
  id: string
  third_party_id: string
  policy_number: string | null
  authorization_number: string | null
  authorized_sessions: number | null
  valid_until: string | null
  active: boolean
  notes: string | null
}
interface Charge {
  id: string
  third_party_id: string
  patient_third_party_id: string | null
  amount_cents: number
  status: string
  service_date: string
  allocations: { amount_cents: number }[]
}

const loaded = ref(false)
const thirdParties = ref<{ id: string; name: string; active: boolean }[]>([])
const covers = ref<Cover[]>([])
const charges = ref<Charge[]>([])

async function load() {
  const [{ data: tps }, { data: cvs }, { data: chs }] = await Promise.all([
    supabase.from('third_parties').select('id, name, active').order('name'),
    supabase
      .from('patient_third_parties')
      .select('id, third_party_id, policy_number, authorization_number, authorized_sessions, valid_until, active, notes')
      .eq('patient_id', props.patientId)
      .order('created_at'),
    supabase
      .from('third_party_charges')
      .select('id, third_party_id, patient_third_party_id, amount_cents, status, service_date, allocations:third_party_payment_allocations(amount_cents)')
      .eq('patient_id', props.patientId)
      .eq('status', 'pending'),
  ])
  thirdParties.value = tps ?? []
  covers.value = cvs ?? []
  charges.value = (chs as unknown as Charge[] | null) ?? []
  loaded.value = true
}
onMounted(load)
watch(() => props.patientId, load)

const canEdit = computed(() => can('billing_access') || can('patients_edit'))
const visible = computed(() => loaded.value && (covers.value.length > 0 || thirdParties.value.some((tp) => tp.active)))
const tpName = (id: string) => thirdParties.value.find((tp) => tp.id === id)?.name ?? '—'
const today = computed(() => new Date().toISOString().slice(0, 10))

const usedBy = (coverId: string) => charges.value.filter((c) => c.patient_third_party_id === coverId).length
const warningsFor = (c: Cover) => (c.active ? coverWarnings(c, usedBy(c.id), today.value).map((w) => coverWarningText(w, t)) : [])

// What each third party still owes for this patient, whichever cover the
// visits were charged under.
const owedByThirdParty = computed(() => {
  const out = new Map<string, number>()
  for (const c of charges.value) {
    const owed = chargeOutstandingCents(c)
    if (owed > 0) out.set(c.third_party_id, (out.get(c.third_party_id) ?? 0) + owed)
  }
  return [...out.entries()].map(([id, cents]) => ({ id, name: tpName(id), cents }))
})

// --- editing ---

interface Draft {
  id: string | null
  third_party_id: string
  policy_number: string
  authorization_number: string
  authorized_sessions: string
  valid_until: string
  notes: string
}
const draft = ref<Draft | null>(null)
const saving = ref(false)
const formError = ref('')
const activeThirdParties = computed(() => thirdParties.value.filter((tp) => tp.active))

function edit(c: Cover | null) {
  formError.value = ''
  draft.value = c
    ? {
        id: c.id,
        third_party_id: c.third_party_id,
        policy_number: c.policy_number ?? '',
        authorization_number: c.authorization_number ?? '',
        authorized_sessions: c.authorized_sessions?.toString() ?? '',
        valid_until: c.valid_until ?? '',
        notes: c.notes ?? '',
      }
    : { id: null, third_party_id: activeThirdParties.value[0]?.id ?? '', policy_number: '', authorization_number: '', authorized_sessions: '', valid_until: '', notes: '' }
}

async function save() {
  const d = draft.value
  if (!d) return
  formError.value = ''
  const sessions = d.authorized_sessions.trim() ? Number(d.authorized_sessions) : null
  if (sessions !== null && (!Number.isInteger(sessions) || sessions <= 0)) {
    formError.value = t('Authorised sessions must be a whole number above zero.', 'Las sesiones autorizadas deben ser un número entero mayor que cero.')
    return
  }
  if (!d.third_party_id) return
  const row = {
    third_party_id: d.third_party_id,
    policy_number: d.policy_number.trim() || null,
    authorization_number: d.authorization_number.trim() || null,
    authorized_sessions: sessions,
    valid_until: d.valid_until || null,
    notes: d.notes.trim() || null,
  }
  saving.value = true
  const { error } = d.id
    ? await supabase.from('patient_third_parties').update(row).eq('id', d.id)
    : await supabase.from('patient_third_parties').insert({ ...row, account_id: store.accountId!, patient_id: props.patientId, created_by: store.teamMember?.id ?? null })
  saving.value = false
  if (error) {
    formError.value = error.message
    return
  }
  draft.value = null
  await load()
}

async function setActive(c: Cover, value: boolean) {
  const { error } = await supabase.from('patient_third_parties').update({ active: value }).eq('id', c.id)
  if (error) return showToast(error.message, 'error')
  c.active = value
}

const input = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none'
const label = 'block text-[12px] font-medium text-ink-700'
</script>

<template>
  <section v-if="visible" aria-labelledby="third-parties-h" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="patient-third-parties">
    <div class="flex items-center justify-between gap-2">
      <h3 id="third-parties-h" class="text-[12px] font-semibold uppercase tracking-[.04em] text-ink-muted2">{{ t('Third parties', 'Terceros') }}</h3>
      <UiBtn v-if="canEdit && !draft && activeThirdParties.length" size="sm" data-cy="patient-tp-add" @click="edit(null)">{{ t('Add cover', 'Añadir cobertura') }}</UiBtn>
    </div>

    <p v-if="covers.length === 0 && !draft" class="mt-1 text-[13px] text-ink-muted2">
      {{ t('Not covered by any insurer or company.', 'Sin cobertura de ninguna aseguradora o empresa.') }}
    </p>

    <ul v-if="covers.length" class="mt-2 divide-y divide-line-row">
      <li v-for="c in covers" :key="c.id" class="py-2" data-cy="patient-tp-cover">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong class="text-[14px]" :class="c.active ? 'text-ink-900' : 'text-ink-500 line-through'">{{ tpName(c.third_party_id) }}</strong>
          <span v-if="c.policy_number" class="text-[12.5px] text-ink-muted">{{ t('Policy', 'Póliza') }} {{ c.policy_number }}</span>
          <span v-if="c.authorization_number" class="text-[12.5px] text-ink-muted">{{ t('Auth.', 'Autoriz.') }} {{ c.authorization_number }}</span>
          <span v-if="c.authorized_sessions != null" class="text-[12.5px] text-ink-muted" data-cy="patient-tp-sessions">
            {{ t(`${usedBy(c.id)} of ${c.authorized_sessions} sessions`, `${usedBy(c.id)} de ${c.authorized_sessions} sesiones`) }}
          </span>
          <span v-if="c.valid_until" class="text-[12.5px] text-ink-muted">{{ t('until', 'hasta') }} {{ new Date(`${c.valid_until}T00:00:00`).toLocaleDateString() }}</span>
          <span class="flex-1" />
          <template v-if="canEdit">
            <button type="button" class="text-[12px] font-medium text-brand-text hover:text-brand-hover" @click="edit(c)">{{ t('Edit', 'Editar') }}</button>
            <button type="button" class="text-[12px] font-medium text-ink-muted hover:text-ink-900" @click="setActive(c, !c.active)">
              {{ c.active ? t('End', 'Finalizar') : t('Reopen', 'Reabrir') }}
            </button>
          </template>
        </div>
        <p v-for="w in warningsFor(c)" :key="w" class="mt-1 rounded-ctl bg-warning-bg px-2 py-1 text-[12.5px] font-medium text-warning-text" data-cy="patient-tp-warning">{{ w }}</p>
      </li>
    </ul>

    <form v-if="draft" class="mt-3 space-y-2 rounded-ctl border border-line bg-surface-subtle p-3" data-cy="patient-tp-form" @submit.prevent="save">
      <div class="grid gap-2 sm:grid-cols-2">
        <div>
          <label :class="label" for="ptp-tp">{{ t('Third party', 'Tercero') }}</label>
          <select id="ptp-tp" v-model="draft.third_party_id" data-cy="patient-tp-third-party" :class="input">
            <option v-for="tp in activeThirdParties" :key="tp.id" :value="tp.id">{{ tp.name }}</option>
          </select>
        </div>
        <div>
          <label :class="label" for="ptp-policy">{{ t('Policy / case number', 'Nº de póliza / expediente') }}</label>
          <input id="ptp-policy" v-model="draft.policy_number" data-cy="patient-tp-policy" :class="input" type="text" />
        </div>
        <div>
          <label :class="label" for="ptp-auth">{{ t('Authorisation number', 'Nº de autorización') }}</label>
          <input id="ptp-auth" v-model="draft.authorization_number" :class="input" type="text" />
        </div>
        <div>
          <label :class="label" for="ptp-sessions">{{ t('Authorised sessions', 'Sesiones autorizadas') }}</label>
          <input id="ptp-sessions" v-model="draft.authorized_sessions" data-cy="patient-tp-sessions-input" :class="input" type="number" min="1" step="1" />
        </div>
        <div>
          <label :class="label" for="ptp-until">{{ t('Valid until', 'Válida hasta') }}</label>
          <input id="ptp-until" v-model="draft.valid_until" :class="input" type="date" />
        </div>
        <div>
          <label :class="label" for="ptp-notes">{{ t('Notes', 'Notas') }}</label>
          <input id="ptp-notes" v-model="draft.notes" :class="input" type="text" />
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UiBtn type="submit" variant="primary" size="sm" data-cy="patient-tp-save" :disabled="saving">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        <UiBtn size="sm" @click="draft = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <p v-if="formError" class="text-[12px] text-danger-text">{{ formError }}</p>
      </div>
    </form>

    <div v-if="owedByThirdParty.length" class="mt-3 border-t border-line-divider pt-2" data-cy="patient-tp-owed">
      <p v-for="o in owedByThirdParty" :key="o.id" class="flex items-center justify-between text-[13px]">
        <span class="text-ink-700">{{ t(`Owed by ${o.name}`, `Pendiente de ${o.name}`) }}</span>
        <span class="font-mono font-medium text-ink-900">{{ formatEur(o.cents) }}</span>
      </p>
      <p class="mt-0.5 text-[12px] text-ink-muted2">{{ t("The third party's debt, not the patient's.", 'Deuda del tercero, no del paciente.') }}</p>
    </div>
  </section>
</template>
