<script setup lang="ts">
import type { Tables } from '~/types/database.types'

interface ActivePackage { id: string; package_name: string; sessions_total: number; sessions_used: number; unallocated_cents: number }

const props = defineProps<{
  patient: Tables<'patients'>
  balanceCents: number
  creditCents: number
  activePackages: ActivePackage[]
  financialLoading: boolean
}>()
const emit = defineEmits<{ message: []; charge: []; photoUpdated: [] }>()

// Money the patient has already paid toward packages but hasn't used yet --
// shown separately from balanceCents/creditCents (real cash credit/debt) so
// an unpaid invoice never reads as "covered" just because a bono has value
// left, but still surfaced prominently: a patient who paid for a bono has
// real money sitting with the clinic, and staff kept asking why the sidebar
// (unlike the appointment billing panel) never showed it.
const packageCreditCents = computed(() => props.activePackages.reduce((sum, p) => sum + p.unallocated_cents, 0))

const canContact = computed(() => !props.patient.is_minor && !props.patient.do_not_contact)

const supabase = useSupabaseClient()
const store = useAccountStore()

const primaryNumber = ref<Tables<'patient_contact_numbers'> | null>(null)
const lifetimeCents = ref(0)
const hasCardOnFile = ref(false)
const loading = ref(true)

async function load() {
  loading.value = true
  const [{ data: numbers }, { data: invoices }, { data: stripeCustomer }] = await Promise.all([
    supabase.from('patient_contact_numbers').select('*').eq('patient_id', props.patient.id).order('created_at').limit(1),
    supabase.from('invoices').select('id').eq('patient_id', props.patient.id).neq('status', 'void'),
    supabase.from('patient_stripe_customers').select('default_payment_method_id').eq('patient_id', props.patient.id).maybeSingle(),
  ])
  primaryNumber.value = numbers?.[0] ?? null
  hasCardOnFile.value = !!stripeCustomer?.default_payment_method_id

  const invoiceIds = (invoices ?? []).map((i) => i.id)
  if (invoiceIds.length > 0) {
    const { data: payments } = await supabase.from('payments').select('amount_cents').in('invoice_id', invoiceIds)
    lifetimeCents.value = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
  } else {
    lifetimeCents.value = 0
  }
  loading.value = false
}
onMounted(load)
watch(() => props.patient.id, load)

function initials() {
  const a = props.patient.first_name?.[0] ?? ''
  const b = props.patient.last_name?.[0] ?? ''
  return (a + b).toUpperCase() || '?'
}

const age = computed(() => {
  if (!props.patient.date_of_birth) return null
  const dob = new Date(props.patient.date_of_birth)
  const now = new Date()
  let years = now.getFullYear() - dob.getFullYear()
  const monthDiff = now.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) years--
  return years
})
const patientSince = computed(() => {
  return new Date(props.patient.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
})
const identityMeta = computed(() => {
  const parts = []
  if (age.value !== null) parts.push(age.value)
  parts.push(`Patient since ${patientSince.value}`)
  return parts.join(' · ')
})

function money(cents: number) {
  const amount = (Math.abs(cents) / 100).toFixed(2)
  return `${cents < 0 ? '-' : ''}€${amount}`
}
</script>

<template>
  <aside class="w-[296px] shrink-0 space-y-4">
    <div class="rounded-card border border-line bg-surface p-4 shadow-card">
      <div class="flex items-center gap-3">
        <PatientsPhotoUpload :patient-id="patient.id" :photo-storage-path="patient.photo_storage_path" :initials="initials()" @uploaded="emit('photoUpdated')" />
        <div class="min-w-0">
          <p class="truncate text-[15px] font-[620] text-ink-900">{{ patient.first_name }} {{ patient.last_name }}</p>
          <p class="text-[12px] text-ink-muted2">{{ identityMeta }}</p>
        </div>
      </div>

      <div v-if="!financialLoading" class="mt-2.5 flex flex-wrap items-center gap-1.5">
        <UiBalancePill :balance-cents="balanceCents" />
        <UiPill v-if="packageCreditCents > 0" tone="brand">€{{ (packageCreditCents / 100).toFixed(2) }} bono</UiPill>
      </div>

      <div class="mt-3.5 grid gap-2" :class="canContact ? 'grid-cols-2' : 'grid-cols-1'">
        <UiBtn v-if="canContact" size="sm" variant="secondary" class="w-full justify-center" @click="emit('message')">WhatsApp</UiBtn>
        <UiBtn size="sm" variant="secondary" class="w-full justify-center" @click="emit('charge')">Charge</UiBtn>
      </div>
    </div>

    <PatientsFlagsPanel :patient-id="patient.id" />
    <PatientsPhaseStats :patient-id="patient.id" />

    <div class="rounded-card border border-line bg-surface p-4 shadow-card">
      <p class="text-[13.5px] font-semibold text-ink-700">Contact</p>
      <dl class="mt-2.5 space-y-2 text-[12.5px]">
        <div>
          <dt class="text-ink-faint">Email</dt>
          <dd class="mt-0.5 truncate text-ink-600">{{ patient.email ?? 'N/A' }}</dd>
        </div>
        <div>
          <dt class="text-ink-faint">Phone</dt>
          <dd class="mt-0.5 text-ink-600">
            <span v-if="primaryNumber">{{ countryByCode(primaryNumber.country_code).flag }} {{ countryByCode(primaryNumber.country_code).dial }} {{ primaryNumber.number }}</span>
            <span v-else>N/A</span>
          </dd>
        </div>
      </dl>
    </div>

    <div class="rounded-card border border-line bg-surface p-4 shadow-card">
      <p class="text-[13.5px] font-semibold text-ink-700">Account</p>
      <div class="mt-2.5 grid grid-cols-2 gap-y-2.5 text-[12.5px]">
        <div>
          <dt class="text-ink-faint">Balance</dt>
          <dd class="mt-0.5 font-mono text-[12.5px]" :class="financialLoading ? 'text-ink-faint' : balanceCents < 0 ? 'text-danger-text' : 'text-ink-700'">
            {{ financialLoading ? '…' : money(balanceCents) }}
          </dd>
        </div>
        <div>
          <dt class="text-ink-faint">Credit</dt>
          <dd class="mt-0.5 font-mono text-[12.5px] text-ink-700">{{ financialLoading ? '…' : money(creditCents) }}</dd>
        </div>
        <div>
          <dt class="text-ink-faint">Bono credit</dt>
          <dd class="mt-0.5 font-mono text-[12.5px] text-ink-700">{{ financialLoading ? '…' : money(packageCreditCents) }}</dd>
        </div>
        <div>
          <dt class="text-ink-faint">Lifetime</dt>
          <dd class="mt-0.5 font-mono text-[12.5px] text-ink-700">{{ loading ? '…' : money(lifetimeCents) }}</dd>
        </div>
        <div>
          <dt class="text-ink-faint">Card on file</dt>
          <dd class="mt-0.5 text-[12.5px] text-ink-700">{{ loading ? '…' : hasCardOnFile ? 'On file' : 'None' }}</dd>
        </div>
      </div>

      <ul v-if="activePackages.length > 0" class="mt-3 space-y-1 border-t border-line-divider pt-2.5">
        <li v-for="p in activePackages" :key="p.id" class="text-[11.5px] text-ink-muted2">
          {{ p.package_name }}: {{ p.sessions_total - p.sessions_used }} left &middot; {{ money(p.unallocated_cents) }} unallocated
        </li>
      </ul>
    </div>
  </aside>
</template>
