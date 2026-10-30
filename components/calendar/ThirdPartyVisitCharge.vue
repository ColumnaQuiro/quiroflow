<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { coverWarnings, coverWarningText, eurosToCents } from '~/utils/thirdParties'

// Charging a visit to a third party -- a mutua, a medico-legal case, a company
// -- instead of, or as well as, the patient (20261023093754).
//
// The third party's share is a third_party_charges row; the patient's receipt
// keeps only their copago, so their balance and debt are exactly what they
// are asked to pay. Both halves are written by one RPC,
// charge_visit_to_third_party, so neither can exist without the other.
//
// Hidden on an account with no third parties: a clinic that does not bill
// insurers sees the Billing tab it always had.
const props = defineProps<{
  appointmentId: string
  patientId: string
  visitPriceCents: number
  invoice: { id: string; status: string; total_cents: number } | null
  hasPayments: boolean
  /** The visit has happened and is not drawn from a bono. */
  canStart: boolean
}>()
const emit = defineEmits<{ changed: [] }>()

const supabase = useSupabaseClient()
const { can } = usePermission()
const t = useT()

interface Cover {
  id: string
  third_party_id: string
  policy_number: string | null
  authorization_number: string | null
  authorized_sessions: number | null
  valid_until: string | null
}
interface PendingCharge {
  id: string
  amount_cents: number
  third_party_id: string
  third_party_payment_allocations: { amount_cents: number }[]
}

const loaded = ref(false)
const thirdParties = ref<{ id: string; name: string; active: boolean }[]>([])
const covers = ref<Cover[]>([])
const usedByCover = ref<Record<string, number>>({})
const rates = ref<{ third_party_id: string; pays_cents: number; copay_cents: number }[]>([])
const charge = ref<PendingCharge | null>(null)
const visitDate = ref('')

const tpName = (id: string) => thirdParties.value.find((tp) => tp.id === id)?.name ?? '—'

async function load() {
  const [{ data: appt }, { data: tps }, { data: cvs }, { data: ch }] = await Promise.all([
    supabase.from('appointments').select('starts_at, appointment_type_id').eq('id', props.appointmentId).maybeSingle(),
    supabase.from('third_parties').select('id, name, active').order('name'),
    supabase
      .from('patient_third_parties')
      .select('id, third_party_id, policy_number, authorization_number, authorized_sessions, valid_until')
      .eq('patient_id', props.patientId)
      .eq('active', true),
    supabase
      .from('third_party_charges')
      .select('id, amount_cents, third_party_id, third_party_payment_allocations(amount_cents)')
      .eq('appointment_id', props.appointmentId)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle(),
  ])
  thirdParties.value = tps ?? []
  covers.value = cvs ?? []
  charge.value = (ch as unknown as PendingCharge | null) ?? null
  if (appt?.starts_at) {
    const d = new Date(appt.starts_at)
    visitDate.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const coverIds = covers.value.map((c) => c.id)
  const [{ data: rateRows }, { data: usedRows }] = await Promise.all([
    appt?.appointment_type_id
      ? supabase.from('third_party_rates').select('third_party_id, pays_cents, copay_cents').eq('appointment_type_id', appt.appointment_type_id)
      : Promise.resolve({ data: [] as { third_party_id: string; pays_cents: number; copay_cents: number }[] }),
    coverIds.length
      ? supabase
          .from('third_party_charges')
          .select('patient_third_party_id, appointment_id')
          .in('patient_third_party_id', coverIds)
          .eq('status', 'pending')
      : Promise.resolve({ data: [] as { patient_third_party_id: string | null; appointment_id: string | null }[] }),
  ])
  rates.value = rateRows ?? []
  const used: Record<string, number> = {}
  // This visit's own charge is not one of the sessions already used before it.
  for (const r of usedRows ?? []) if (r.patient_third_party_id && r.appointment_id !== props.appointmentId) used[r.patient_third_party_id] = (used[r.patient_third_party_id] ?? 0) + 1
  usedByCover.value = used
  loaded.value = true
}
onMounted(load)
watch(() => props.appointmentId, load)

const activeThirdParties = computed(() => thirdParties.value.filter((tp) => tp.active))
const otherThirdParties = computed(() => activeThirdParties.value.filter((tp) => !covers.value.some((c) => c.third_party_id === tp.id)))

const allocatedCents = computed(() => (charge.value?.third_party_payment_allocations ?? []).reduce((s, a) => s + a.amount_cents, 0))

const canOffer = computed(
  () =>
    loaded.value &&
    !charge.value &&
    activeThirdParties.value.length > 0 &&
    can('billing_access') &&
    props.canStart &&
    (!props.invoice || (props.invoice.status === 'unpaid' && !props.hasPayments)),
)

// --- the form ---
const open = ref(false)
const payer = ref('') // 'cover:<id>' or 'tp:<id>'
const tpAmount = ref('')
const patientAmount = ref('')
const saving = ref(false)
const error = ref('')

const selectedCover = computed(() => (payer.value.startsWith('cover:') ? covers.value.find((c) => c.id === payer.value.slice(6)) ?? null : null))
const selectedThirdPartyId = computed(() => selectedCover.value?.third_party_id ?? (payer.value.startsWith('tp:') ? payer.value.slice(3) : ''))
const warnings = computed(() =>
  selectedCover.value ? coverWarnings(selectedCover.value, usedByCover.value[selectedCover.value.id] ?? 0, visitDate.value).map((w) => coverWarningText(w, t)) : [],
)

function coverLabel(c: Cover) {
  const bits = [tpName(c.third_party_id)]
  if (c.policy_number) bits.push(t(`policy ${c.policy_number}`, `póliza ${c.policy_number}`))
  if (c.authorized_sessions != null) bits.push(`${usedByCover.value[c.id] ?? 0}/${c.authorized_sessions}`)
  return bits.join(' · ')
}

// A rate for this type of visit says what the third party pays and what the
// patient adds; without one, the third party is offered the visit's price.
watch(selectedThirdPartyId, (id) => {
  if (!id) return
  const rate = rates.value.find((r) => r.third_party_id === id)
  tpAmount.value = ((rate ? rate.pays_cents : props.visitPriceCents) / 100).toFixed(2)
  patientAmount.value = ((rate ? rate.copay_cents : 0) / 100).toFixed(2)
})

function start() {
  error.value = ''
  open.value = true
  const first = covers.value.find((c) => activeThirdParties.value.some((tp) => tp.id === c.third_party_id))
  payer.value = first ? `cover:${first.id}` : otherThirdParties.value[0] ? `tp:${otherThirdParties.value[0].id}` : ''
}

async function save() {
  error.value = ''
  const tpCents = eurosToCents(tpAmount.value)
  const patientCents = eurosToCents(patientAmount.value) ?? 0
  if (!selectedThirdPartyId.value) return
  if (!tpCents || tpCents <= 0) {
    error.value = t('Enter what the third party pays.', 'Indica lo que paga el tercero.')
    return
  }
  if (patientCents < 0) {
    error.value = t("The patient's share cannot be negative.", 'La parte del paciente no puede ser negativa.')
    return
  }
  saving.value = true
  const { error: rpcError } = await supabase.rpc('charge_visit_to_third_party', {
    p_appointment_id: props.appointmentId,
    p_third_party_id: selectedThirdPartyId.value,
    p_third_party_cents: tpCents,
    p_patient_cents: patientCents,
    p_patient_third_party_id: selectedCover.value?.id,
    p_list_price_cents: props.visitPriceCents,
  })
  saving.value = false
  if (rpcError) {
    error.value = rpcError.message
    return
  }
  open.value = false
  await load()
  emit('changed')
}

async function remove() {
  if (!charge.value) return
  error.value = ''
  saving.value = true
  const { error: rpcError } = await supabase.rpc('remove_third_party_charge', { p_charge_id: charge.value.id })
  saving.value = false
  if (rpcError) {
    error.value = rpcError.message
    return
  }
  await load()
  emit('changed')
}

const field = 'mt-1 w-full rounded-ctl border border-line-control bg-surface px-2 py-1.5 text-sm text-ink-700 focus:border-brand focus:outline-none'
</script>

<template>
  <div v-if="charge" class="rounded-card border border-line bg-surface p-3" data-cy="tp-visit-charge">
    <div class="flex items-center justify-between gap-2">
      <p class="text-[13px] text-ink-700">
        <span class="font-medium text-ink-900">{{ tpName(charge.third_party_id) }}</span>
        {{ t('pays', 'paga') }} <span class="font-mono font-medium text-ink-900" data-cy="tp-visit-charge-amount">{{ formatEur(charge.amount_cents) }}</span>
      </p>
      <span
        class="rounded-ctlSm px-1.5 py-0.5 text-xs font-medium"
        :class="allocatedCents >= charge.amount_cents ? 'bg-success-bg text-success-text' : 'bg-chip-bg text-chip-text'"
      >
        {{ allocatedCents >= charge.amount_cents ? t('paid by the third party', 'pagado por el tercero') : t('pending from the third party', 'pendiente del tercero') }}
      </span>
    </div>
    <p class="mt-0.5 text-[12.5px] text-ink-muted2">
      {{ t("Not part of the patient's balance. Collected from the third party under Billing → Third parties.", 'No forma parte del saldo del paciente. Se cobra al tercero en Facturación → Terceros.') }}
    </p>
    <button
      v-if="allocatedCents === 0 && can('billing_access')"
      type="button"
      data-cy="tp-visit-remove"
      class="mt-1.5 text-xs font-medium text-ink-muted hover:text-danger-text disabled:opacity-50"
      :disabled="saving"
      @click="remove"
    >
      {{ t('Take the third party off this visit', 'Quitar el tercero de esta visita') }}
    </button>
    <p v-if="error" class="mt-1 text-[12.5px] text-danger-text">{{ error }}</p>
  </div>

  <div v-else-if="canOffer" class="rounded-card border border-line bg-surface p-3">
    <button v-if="!open" type="button" data-cy="tp-visit-start" class="text-[13px] font-medium text-brand-text hover:text-brand-hover" @click="start">
      {{ t('Bill a third party (insurer, mutua, company)…', 'Facturar a un tercero (aseguradora, mutua, empresa)…') }}
    </button>
    <form v-else class="space-y-2" @submit.prevent="save">
      <p class="text-[13px] font-medium text-ink-700">{{ t('Bill a third party', 'Facturar a un tercero') }}</p>
      <div>
        <label class="block text-xs font-medium text-ink-700" for="tp-visit-payer">{{ t('Who pays', 'Quién paga') }}</label>
        <select id="tp-visit-payer" v-model="payer" data-cy="tp-visit-payer" :class="field">
          <optgroup v-if="covers.length" :label="t(`This patient's cover`, 'Coberturas del paciente')">
            <option v-for="c in covers" :key="c.id" :value="`cover:${c.id}`">{{ coverLabel(c) }}</option>
          </optgroup>
          <optgroup v-if="otherThirdParties.length" :label="covers.length ? t('Other third parties', 'Otros terceros') : t('Third parties', 'Terceros')">
            <option v-for="tp in otherThirdParties" :key="tp.id" :value="`tp:${tp.id}`">{{ tp.name }}</option>
          </optgroup>
        </select>
      </div>
      <p v-for="w in warnings" :key="w" data-cy="tp-visit-warning" class="rounded-ctl bg-warning-bg px-2 py-1 text-[12.5px] font-medium text-warning-text">{{ w }}</p>
      <div class="flex flex-wrap gap-3">
        <div>
          <label class="block text-xs font-medium text-ink-700" for="tp-visit-tp-amount">{{ t('Third party pays (€)', 'Paga el tercero (€)') }}</label>
          <input id="tp-visit-tp-amount" v-model="tpAmount" data-cy="tp-visit-tp-amount" type="text" inputmode="decimal" :class="field" class="!w-28" />
        </div>
        <div>
          <label class="block text-xs font-medium text-ink-700" for="tp-visit-patient-amount">{{ t('Patient pays (€)', 'Paga el paciente (€)') }}</label>
          <input id="tp-visit-patient-amount" v-model="patientAmount" data-cy="tp-visit-patient-amount" type="text" inputmode="decimal" :class="field" class="!w-28" />
        </div>
      </div>
      <p class="text-[12px] text-ink-muted2">
        {{ t("The patient's receipt keeps only their share; the rest is owed by the third party.", 'El recibo del paciente queda solo con su parte; el resto lo debe el tercero.') }}
      </p>
      <div class="flex items-center gap-3">
        <button type="submit" data-cy="tp-visit-save" :disabled="saving || !selectedThirdPartyId" class="rounded-ctl bg-brand px-3 py-1.5 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50">
          {{ saving ? t('Working…', 'Procesando…') : t('Bill', 'Facturar') }}
        </button>
        <button type="button" class="text-xs font-medium text-ink-muted hover:text-ink-900" @click="open = false">{{ t('Cancel', 'Cancelar') }}</button>
      </div>
      <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>
    </form>
  </div>
</template>
