<script setup lang="ts">
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const route = useRoute()
const appointmentId = route.params.id as string

interface Appointment {
  id: string
  patient_id: string
  starts_at: string
  ends_at: string
  status: string
  checked_in_at: string | null
  appointment_type_id: string | null
  practitioner_id: string | null
  patients: { first_name: string; last_name: string | null } | null
  appointment_types: { name: string; default_price_cents: number } | null
}

const supabase = useSupabaseClient()
const { context, can, restricted } = usePractitionerContext()

const appointment = ref<Appointment | null>(null)
const loading = ref(true)
const billingOpen = ref(false)
// The practitioner's own price for this type when they have one -- what the
// desktop calendar and online booking charge (effectivePriceCents) -- else
// the type's default. Read when billing opens.
const visitPriceCents = ref<number | undefined>(undefined)

async function loadAppointment() {
  const { data } = await supabase
    .from('appointments')
    .select('id, patient_id, starts_at, ends_at, status, checked_in_at, appointment_type_id, practitioner_id, patients(first_name, last_name), appointment_types(name, default_price_cents)')
    .eq('id', appointmentId)
    .maybeSingle()
  appointment.value = data as unknown as Appointment
  loading.value = false
}
onMounted(loadAppointment)

async function checkIn() {
  await supabase.from('appointments').update({ checked_in_at: new Date().toISOString() } as never).eq('id', appointmentId)
  await loadAppointment()
}

// Charging the visit is the web's own implementation (composables/
// useVisitCharging.ts, which the calendar's Billing tab uses too), not a copy
// of it. This screen used to carry one, and it had drifted: it raised an
// invoice the moment billing was opened, numbered from a head count of every
// invoice, wrote facturas without the tax breakdown, settled from totals read
// when the sheet opened, and could take a second bono session for one visit.
// Who is charging comes from usePractitionerContext, since there is no
// account store in this app.
const {
  creditLedgerCents,
  activePackages,
  invoice,
  loadingInvoice,
  appointmentIsUpcoming,
  packageCoverage,
  saving,
  error,
  paidCents,
  balanceDueCents,
  paymentMethods,
  paymentRows,
  paymentTotalCents,
  init: initCharging,
  chargeVisit,
  usePackageSession,
  recordPayment,
} = useVisitCharging({
  appointmentId,
  patientId: () => appointment.value?.patient_id ?? '',
  appointmentTypeName: () => appointment.value?.appointment_types?.name,
  appointmentTypePriceCents: visitPriceCents,
  accountId: () => context.value?.accountId,
  teamMemberId: () => context.value?.teamMemberId,
  can,
  onCompleted: () => {
    loadAppointment()
  },
})

async function loadVisitPrice() {
  const appt = appointment.value
  if (!appt) return
  let priceCents = appt.appointment_types?.default_price_cents ?? 0
  if (appt.appointment_type_id && appt.practitioner_id) {
    const { data: override } = await supabase
      .from('appointment_type_overrides')
      .select('price_cents')
      .eq('appointment_type_id', appt.appointment_type_id)
      .eq('team_member_id', appt.practitioner_id)
      .maybeSingle()
    const own = (override as { price_cents: number | null } | null)?.price_cents
    if (own != null) priceCents = own
  }
  visitPriceCents.value = priceCents
}

// Opening billing is a read. Nothing is written until "Charge" or a bono is
// pressed -- the same choice the web's Billing tab offers.
async function openBilling() {
  billingOpen.value = true
  await loadVisitPrice()
  await initCharging()
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function euros(cents: number) {
  return `€${(cents / 100).toFixed(2)}`
}
// The rate a bono button quotes, rounded the way the session is billed.
function bonoRateLabel(p: { price_cents: number; sessions_total: number }) {
  return p.sessions_total ? euros(bonoPerSessionCents(p)) : '—'
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center text-[15px] text-brand-text" @click="navigateTo('/calendar')">&larr;</button>
      <p class="truncate text-[15px] font-[600] text-ink-900">Appointment</p>
    </div>

    <div v-if="loading" class="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>
    <p v-else-if="!appointment" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">Appointment not found.</p>

    <div v-else class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <div>
        <p class="text-[17px] font-semibold text-ink-900">{{ appointment.patients?.first_name }} {{ appointment.patients?.last_name ?? '' }}</p>
        <p class="mt-1 text-[13.5px] text-ink-muted2">{{ formatDate(appointment.starts_at) }} · {{ appointment.appointment_types?.name ?? 'Appointment' }}</p>
        <p class="mt-1 text-[12px] font-medium uppercase tracking-wide text-ink-faint">{{ appointment.status }}</p>
      </div>

      <NuxtLink :to="`/patients/${appointment.patient_id}`" class="block rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] font-medium text-brand-text shadow-card">
        View patient →
      </NuxtLink>

      <button
        v-if="!appointment.checked_in_at && appointment.status !== 'completed' && !restricted('calendar_read_only')"
        type="button"
        class="w-full rounded-ctl border border-line-control px-4 py-2.5 text-center text-[14px] font-medium text-brand-text active:bg-surface-subtle"
        @click="checkIn"
      >
        Check in
      </button>

      <div v-if="!billingOpen && can('billing_access') && !restricted('calendar_read_only')">
        <button
          type="button"
          class="w-full rounded-ctl bg-brand px-4 py-2.5 text-center text-[14px] font-medium text-white active:opacity-90"
          @click="openBilling"
        >
          Bill this visit
        </button>
      </div>

      <div v-else-if="billingOpen" class="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p class="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-faint">Billing</p>
        <p v-if="loadingInvoice" class="text-[13px] text-ink-faint">Loading…</p>
        <p v-else-if="!invoice && appointmentIsUpcoming" class="text-[13px] text-ink-faint">
          This appointment hasn't happened yet — no receipt until it does.
        </p>
        <!-- No invoice because a bono covered the visit -- say so, rather than
        an empty sheet. -->
        <p v-else-if="!invoice && packageCoverage" class="text-[13px] text-ink-muted2">
          Covered by {{ packageCoverage.packageName || 'a bono' }} — worth {{ euros(packageCoverage.amountCents) }}, already paid when the bono was bought.
        </p>
        <!-- Past visit, nothing billed yet: charge it, or spend a bono session.
        Nothing is owed until one is pressed. -->
        <div v-else-if="!invoice" class="space-y-2">
          <p class="text-[13.5px] text-ink-700">
            Not charged yet · {{ appointment.appointment_types?.name ?? 'Appointment' }}<span v-if="(visitPriceCents ?? 0) > 0"> — {{ euros(visitPriceCents ?? 0) }}</span>
          </p>
          <button
            v-for="p in activePackages"
            :key="p.id"
            type="button"
            class="w-full rounded-ctl bg-brand px-4 py-2.5 text-center text-[14px] font-medium text-white active:opacity-90 disabled:opacity-50"
            :disabled="saving"
            @click="usePackageSession(p)"
          >
            Use {{ p.package_name }} — {{ bonoRateLabel(p) }} ({{ p.sessions_total - p.sessions_used }} left)
          </button>
          <UiBtn :variant="activePackages.length > 0 ? 'secondary' : 'primary'" class="w-full" :disabled="saving" @click="chargeVisit">
            {{ saving ? 'Saving…' : `Charge ${(visitPriceCents ?? 0) > 0 ? euros(visitPriceCents ?? 0) : 'this visit'}${activePackages.length > 0 ? ' instead' : ''}` }}
          </UiBtn>
        </div>
        <template v-else>
          <p v-if="packageCoverage" class="mb-2 text-[12.5px] text-ink-muted2">
            Covered by {{ packageCoverage.packageName || 'a bono' }} — charged at the bono rate against money already paid.
          </p>
          <p class="text-[13.5px] text-ink-700">{{ invoice.invoice_number }} · <span :class="invoice.status === 'paid' ? 'text-success-text' : 'text-warning-text'">{{ invoice.status }}</span></p>
          <p class="mt-1 text-[13px] text-ink-muted2">Total {{ euros(invoice.total_cents) }} · Paid {{ euros(paidCents) }}<span v-if="balanceDueCents > 0"> · Due {{ euros(balanceDueCents) }}</span></p>

          <div v-if="can('payments_allocate') && invoice.status !== 'void' && balanceDueCents > 0" class="mt-3 space-y-2">
            <div v-for="(row, i) in paymentRows" :key="i" class="flex gap-2">
              <input
                v-model="row.amount"
                type="number"
                step="0.01"
                min="0"
                class="w-24 rounded-ctl border border-line-control px-2.5 py-2 text-[14px]"
              />
              <select v-model="row.method" class="flex-1 rounded-ctl border border-line-control px-2.5 py-2 text-[14px]">
                <option v-for="m in paymentMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
                <option v-if="creditLedgerCents > 0" value="credit">Credit on account ({{ euros(creditLedgerCents) }} available)</option>
              </select>
            </div>
            <UiBtn variant="primary" class="w-full" :disabled="saving || paymentTotalCents <= 0" @click="recordPayment">{{ saving ? 'Saving…' : `Record ${euros(paymentTotalCents)}` }}</UiBtn>
          </div>

          <div v-if="can('billing_access') && invoice.status !== 'paid' && activePackages.length > 0" class="mt-2 flex flex-wrap items-center gap-2 border-t border-line-divider pt-2">
            <span class="text-[12px] text-ink-muted2">Or use a package session:</span>
            <button
              v-for="p in activePackages"
              :key="p.id"
              type="button"
              class="rounded-ctl border border-brand-tintBorder bg-brand-tint px-2 py-1 text-[12px] font-medium text-brand-text active:brightness-95"
              :disabled="saving"
              @click="usePackageSession(p)"
            >
              {{ p.package_name }} ({{ p.sessions_total - p.sessions_used }} left)
            </button>
          </div>
        </template>
        <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
      </div>
    </div>
  </div>
</template>
