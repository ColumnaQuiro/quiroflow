<script setup lang="ts">
import type { Tables } from '~/types/database.types'

interface ActivePackage { id: string; package_name: string; sessions_total: number; sessions_used: number }

const props = defineProps<{
  patient: Tables<'patients'>
  balanceCents: number
  creditCents: number
  activePackages: ActivePackage[]
  financialLoading: boolean
}>()
const emit = defineEmits<{ message: []; charge: []; photoUpdated: [] }>()

const canContact = computed(() => !props.patient.is_minor && !props.patient.do_not_contact)

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const primaryNumber = ref<Tables<'patient_contact_numbers'> | null>(null)
const hasCardOnFile = ref(false)
const loading = ref(true)

// "Lifetime" is the sum of everything the patient has paid, which
// usePatientFinancialSummary already computes (it needs it for balanceCents
// anyway) and shares across every call site for this patient. This used to
// be re-derived here with an invoices query and then a *dependent* payments
// query -- a second serial round-trip on every patient open, duplicating
// two queries the summary had already run. Reading the shared value also
// means it stays correct after a payment is recorded, instead of going
// stale until the component remounted.
const { lifetimeCents, loading: financialSummaryLoading } = usePatientFinancialSummary(() => props.patient.id)

async function load() {
  loading.value = true
  const [{ data: numbers }, { data: stripeCustomer }] = await Promise.all([
    supabase.from('patient_contact_numbers').select('*').eq('patient_id', props.patient.id).order('created_at').limit(1),
    supabase.from('patient_stripe_customers').select('default_payment_method_id').eq('patient_id', props.patient.id).maybeSingle(),
  ])
  primaryNumber.value = numbers?.[0] ?? null
  hasCardOnFile.value = !!stripeCustomer?.default_payment_method_id
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
  parts.push(`${t('Patient since', 'Paciente desde')} ${patientSince.value}`)
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

      <UiBalancePill v-if="!financialLoading" class="mt-2.5" :balance-cents="balanceCents" />

      <div class="mt-3.5 grid gap-2" :class="canContact ? 'grid-cols-2' : 'grid-cols-1'">
        <UiBtn v-if="canContact" size="sm" variant="secondary" class="w-full justify-center" @click="emit('message')">WhatsApp</UiBtn>
        <UiBtn size="sm" variant="secondary" class="w-full justify-center" @click="emit('charge')">{{ t('Charge', 'Cobrar') }}</UiBtn>
      </div>
    </div>

    <PatientsStickyNotePanel :patient-id="patient.id" />
    <PatientsFlagsPanel :patient-id="patient.id" />
    <PatientsPhaseStats :patient-id="patient.id" />

    <div class="rounded-card border border-line bg-surface p-4 shadow-card">
      <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Contact', 'Contacto') }}</p>
      <dl class="mt-2.5 space-y-2 text-[12.5px]">
        <div>
          <dt class="text-ink-faint">{{ t('Email', 'Correo electrónico') }}</dt>
          <dd class="mt-0.5 truncate text-ink-600">{{ patient.email ?? t('N/A', 'N/D') }}</dd>
        </div>
        <div>
          <dt class="text-ink-faint">{{ t('Phone', 'Teléfono') }}</dt>
          <dd class="mt-0.5 text-ink-600">
            <span v-if="primaryNumber">{{ countryByCode(primaryNumber.country_code).flag }} {{ countryByCode(primaryNumber.country_code).dial }} {{ primaryNumber.number }}</span>
            <span v-else>{{ t('N/A', 'N/D') }}</span>
          </dd>
        </div>
      </dl>
    </div>

    <div class="rounded-card border border-line bg-surface p-4 shadow-card">
      <p class="text-[13.5px] font-semibold text-ink-700">{{ t('Account', 'Cuenta') }}</p>
      <div class="mt-2.5 grid grid-cols-2 gap-y-2.5 text-[12.5px]">
        <div>
          <dt class="text-ink-faint">{{ t('Balance', 'Saldo') }}</dt>
          <dd class="mt-0.5 font-mono text-[12.5px]" :class="financialLoading ? 'text-ink-faint' : balanceCents < 0 ? 'text-danger-text' : 'text-ink-700'">
            {{ financialLoading ? '…' : money(balanceCents) }}
          </dd>
        </div>
        <div>
          <dt class="text-ink-faint">{{ t('Credit', 'Crédito') }}</dt>
          <dd class="mt-0.5 font-mono text-[12.5px] text-ink-700">{{ financialLoading ? '…' : money(creditCents) }}</dd>
        </div>
        <div>
          <dt class="text-ink-faint">{{ t('Lifetime', 'Total histórico') }}</dt>
          <dd class="mt-0.5 font-mono text-[12.5px] text-ink-700">{{ financialSummaryLoading ? '…' : money(lifetimeCents) }}</dd>
        </div>
        <div>
          <dt class="text-ink-faint">{{ t('Card on file', 'Tarjeta registrada') }}</dt>
          <dd class="mt-0.5 text-[12.5px] text-ink-700">{{ loading ? '…' : hasCardOnFile ? t('On file', 'Registrada') : t('None', 'Ninguna') }}</dd>
        </div>
      </div>

      <ul v-if="activePackages.length > 0" class="mt-3 space-y-1 border-t border-line-divider pt-2.5">
        <li v-for="p in activePackages" :key="p.id" class="text-[11.5px] text-ink-muted2">{{ p.package_name }}: {{ p.sessions_total - p.sessions_used }} {{ t('left', 'restantes') }}</li>
      </ul>
    </div>
  </aside>
</template>
