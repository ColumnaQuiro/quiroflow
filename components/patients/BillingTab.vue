<script setup lang="ts">
const props = defineProps<{ patientId: string }>()

interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  total_cents: number
  created_at: string
}
interface PackageTemplate { id: string; name: string; session_count: number; price_cents: number }
interface PackagePurchaseRow {
  id: string
  package_name: string
  sessions_total: number
  sessions_used: number
  price_cents: number
  purchased_at: string
}
interface MembershipTemplate { id: string; name: string; price_cents: number }
interface PatientMembershipRow {
  id: string
  membership_name: string
  price_cents: number
  status: string
  started_at: string
}
interface MembershipPaymentRow {
  id: string
  patient_membership_id: string
  period_start: string
  amount_cents: number
  status: string
}
interface StripeCustomerRow { stripe_customer_id: string; default_payment_method_id: string | null }
interface PaymentScheduleRow {
  id: string
  package_purchase_id: string | null
  patient_membership_id: string | null
  interval: string
  interval_count: number
  installments_total: number | null
  installments_paid: number
  status: string
}
interface StripeEventRow { id: string; payment_schedule_id: string; period_start: string; amount_cents: number; status: string }

const supabase = useSupabaseClient()
const store = useAccountStore()

const { creditLedgerCents, refresh: refreshCreditSummary } = usePatientFinancialSummary(() => props.patientId)
const creditHistory = ref<{ id: string; amount_cents: number; reason: string | null; created_at: string }[]>([])
const addCreditAmount = ref('')
const addCreditReason = ref('')
const addingCredit = ref(false)
const applyCreditInvoiceId = ref('')
const applyCreditAmount = ref('')
const applyingCredit = ref(false)
const creditError = ref('')

async function loadCreditHistory() {
  const { data } = await supabase
    .from('account_credits')
    .select('id, amount_cents, reason, created_at')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
    .limit(10)
  creditHistory.value = data ?? []
}

async function addCredit() {
  const amountCents = Math.round((parseFloat(addCreditAmount.value) || 0) * 100)
  if (amountCents <= 0) return
  creditError.value = ''
  addingCredit.value = true
  await supabase.from('account_credits').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    amount_cents: amountCents,
    reason: addCreditReason.value || null,
    created_by: store.teamMember?.id ?? null,
  })
  addCreditAmount.value = ''
  addCreditReason.value = ''
  addingCredit.value = false
  await Promise.all([refreshCreditSummary(), loadCreditHistory()])
}

async function applyCreditToInvoice() {
  const invoice = invoices.value.find((i) => i.id === applyCreditInvoiceId.value)
  if (!invoice) return
  const amountCents = Math.round((parseFloat(applyCreditAmount.value) || 0) * 100)
  if (amountCents <= 0 || amountCents > creditLedgerCents.value) {
    creditError.value = 'Amount must be positive and not exceed available credit.'
    return
  }
  creditError.value = ''
  applyingCredit.value = true

  await supabase.from('payments').insert({
    account_id: store.accountId!,
    invoice_id: invoice.id,
    amount_cents: amountCents,
    method: 'other',
  })
  await supabase.from('account_credits').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    amount_cents: -amountCents,
    reason: `Applied to invoice ${invoice.invoice_number}`,
    invoice_id: invoice.id,
    created_by: store.teamMember?.id ?? null,
  })

  const { data: paid } = await supabase.from('payments').select('amount_cents').eq('invoice_id', invoice.id)
  const paidCents = (paid ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
  if (paidCents >= invoice.total_cents) {
    await supabase.from('invoices').update({ status: 'paid' }).eq('id', invoice.id)
  }

  applyCreditInvoiceId.value = ''
  applyCreditAmount.value = ''
  applyingCredit.value = false
  await Promise.all([refreshCreditSummary(), loadCreditHistory(), loadAll()])
}

const showCardModal = ref(false)
const stripeCustomer = ref<StripeCustomerRow | null>(null)
const schedules = ref<PaymentScheduleRow[]>([])
const stripeEvents = ref<StripeEventRow[]>([])
const autopayFormFor = ref<string | null>(null)
const autopayInstallments = ref(1)
const autopayIntervalCount = ref(1)
const autopayInterval = ref<'day' | 'week' | 'month' | 'year'>('month')
const autopayAlreadyPaid = ref(0)
const settingUpAutopay = ref(false)
const autopayError = ref('')

const invoices = ref<InvoiceRow[]>([])
const loading = ref(true)

const packageTemplates = ref<PackageTemplate[]>([])
const purchases = ref<PackagePurchaseRow[]>([])
const sellPackageId = ref('')
const sellingPackage = ref(false)

const membershipTemplates = ref<MembershipTemplate[]>([])
const patientMemberships = ref<PatientMembershipRow[]>([])
const membershipPayments = ref<MembershipPaymentRow[]>([])
const activateMembershipId = ref('')
const activatingMembership = ref(false)

async function loadAll() {
  const [{ data: inv }, { data: pkgTemplates }, { data: pkgPurchases }, { data: memTemplates }, { data: patMemberships }] = await Promise.all([
    supabase.from('invoices').select('id, invoice_number, status, total_cents, created_at').eq('patient_id', props.patientId).order('created_at', { ascending: false }),
    supabase.from('packages').select('id, name, session_count, price_cents').order('name'),
    supabase.from('package_purchases').select('id, package_name, sessions_total, sessions_used, price_cents, purchased_at').eq('patient_id', props.patientId).order('purchased_at', { ascending: false }),
    supabase.from('memberships').select('id, name, price_cents').order('name'),
    supabase.from('patient_memberships').select('id, membership_name, price_cents, status, started_at').eq('patient_id', props.patientId).order('started_at', { ascending: false }),
  ])
  invoices.value = inv ?? []
  packageTemplates.value = pkgTemplates ?? []
  purchases.value = pkgPurchases ?? []
  membershipTemplates.value = memTemplates ?? []
  patientMemberships.value = (patMemberships as PatientMembershipRow[]) ?? []

  if (patientMemberships.value.length > 0) {
    const { data: payments } = await supabase
      .from('membership_payments')
      .select('id, patient_membership_id, period_start, amount_cents, status')
      .in('patient_membership_id', patientMemberships.value.map((m) => m.id))
      .order('period_start', { ascending: false })
    membershipPayments.value = payments ?? []
  }

  const [{ data: customer }, { data: sch }] = await Promise.all([
    supabase.from('patient_stripe_customers').select('stripe_customer_id, default_payment_method_id').eq('patient_id', props.patientId).maybeSingle(),
    supabase
      .from('payment_schedules')
      .select('id, package_purchase_id, patient_membership_id, interval, interval_count, installments_total, installments_paid, status')
      .eq('patient_id', props.patientId),
  ])
  stripeCustomer.value = customer
  schedules.value = sch ?? []

  if (schedules.value.length > 0) {
    const { data: events } = await supabase
      .from('stripe_payment_events')
      .select('id, payment_schedule_id, period_start, amount_cents, status')
      .in('payment_schedule_id', schedules.value.map((s) => s.id))
      .order('period_start', { ascending: false })
    stripeEvents.value = events ?? []
  }

  loading.value = false
}
onMounted(() => {
  loadAll()
  loadCreditHistory()
})

const hasCard = computed(() => !!stripeCustomer.value?.default_payment_method_id)
const unpaidInvoices = computed(() => invoices.value.filter((i) => i.status === 'unpaid'))

function scheduleForPackage(purchaseId: string) {
  return schedules.value.find((s) => s.package_purchase_id === purchaseId)
}
function scheduleForMembership(membershipId: string) {
  return schedules.value.find((s) => s.patient_membership_id === membershipId)
}
function eventsForSchedule(scheduleId: string) {
  return stripeEvents.value.filter((e) => e.payment_schedule_id === scheduleId)
}

function openAutopayForm(id: string) {
  autopayFormFor.value = id
  autopayError.value = ''
  autopayInstallments.value = 1
  autopayIntervalCount.value = 1
  autopayInterval.value = 'month'
  autopayAlreadyPaid.value = 0
}

async function setUpPackageAutopay(purchase: PackagePurchaseRow) {
  autopayError.value = ''
  settingUpAutopay.value = true
  try {
    await $fetch('/api/stripe/create-schedule', {
      method: 'POST',
      body: {
        patientId: props.patientId,
        packagePurchaseId: purchase.id,
        description: purchase.package_name,
        totalAmountCents: purchase.price_cents,
        installments: autopayInstallments.value,
        interval: autopayInterval.value,
        intervalCount: autopayIntervalCount.value,
        installmentsAlreadyPaid: autopayAlreadyPaid.value,
      },
    })
    autopayFormFor.value = null
    await loadAll()
  } catch (err: any) {
    autopayError.value = err?.data?.statusMessage ?? 'Could not set up autopay'
  } finally {
    settingUpAutopay.value = false
  }
}

async function setUpMembershipAutopay(m: PatientMembershipRow) {
  autopayError.value = ''
  settingUpAutopay.value = true
  try {
    await $fetch('/api/stripe/create-schedule', {
      method: 'POST',
      body: {
        patientId: props.patientId,
        patientMembershipId: m.id,
        description: m.membership_name,
        totalAmountCents: m.price_cents,
        interval: autopayInterval.value,
        intervalCount: autopayIntervalCount.value,
      },
    })
    autopayFormFor.value = null
    await loadAll()
  } catch (err: any) {
    autopayError.value = err?.data?.statusMessage ?? 'Could not set up autopay'
  } finally {
    settingUpAutopay.value = false
  }
}

async function cancelAutopay(scheduleId: string) {
  if (!confirm('Cancel automatic Stripe billing for this?')) return
  await $fetch('/api/stripe/cancel-schedule', { method: 'POST', body: { paymentScheduleId: scheduleId } })
  await loadAll()
}

const scheduleStatusClass: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  completed: 'bg-gray-100 text-gray-500',
  canceled: 'bg-gray-100 text-gray-500',
  past_due: 'bg-red-50 text-red-700',
}

const statusClass: Record<string, string> = {
  paid: 'bg-green-50 text-green-700',
  unpaid: 'bg-red-50 text-red-700',
  void: 'bg-gray-100 text-gray-500',
  failed: 'bg-red-50 text-red-700',
  active: 'bg-green-50 text-green-700',
  paused: 'bg-amber-50 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

async function sellPackage() {
  const tpl = packageTemplates.value.find((p) => p.id === sellPackageId.value)
  if (!tpl) return
  sellingPackage.value = true
  await supabase.from('package_purchases').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    package_id: tpl.id,
    package_name: tpl.name,
    sessions_total: tpl.session_count,
    price_cents: tpl.price_cents,
    created_by: store.teamMember?.id ?? null,
  })
  sellingPackage.value = false
  sellPackageId.value = ''
  await loadAll()
}

async function useSession(purchase: PackagePurchaseRow) {
  if (purchase.sessions_used >= purchase.sessions_total) return
  await supabase.from('package_purchases').update({ sessions_used: purchase.sessions_used + 1 }).eq('id', purchase.id)
  await loadAll()
}

async function activateMembership() {
  const tpl = membershipTemplates.value.find((m) => m.id === activateMembershipId.value)
  if (!tpl) return
  activatingMembership.value = true
  await supabase.from('patient_memberships').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    membership_id: tpl.id,
    membership_name: tpl.name,
    price_cents: tpl.price_cents,
    created_by: store.teamMember?.id ?? null,
  })
  activatingMembership.value = false
  activateMembershipId.value = ''
  await loadAll()
}

async function setMembershipStatus(m: PatientMembershipRow, status: string) {
  await supabase.from('patient_memberships').update({ status }).eq('id', m.id)
  await loadAll()
}

function paymentsFor(membershipId: string) {
  return membershipPayments.value.filter((p) => p.patient_membership_id === membershipId)
}

async function logPayment(m: PatientMembershipRow, status: 'paid' | 'failed') {
  const periodStart = new Date()
  periodStart.setDate(1)
  await supabase.from('membership_payments').insert({
    account_id: store.accountId!,
    patient_membership_id: m.id,
    period_start: periodStart.toISOString().slice(0, 10),
    amount_cents: m.price_cents,
    status,
  })
  await loadAll()
}
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-lg border border-gray-200 bg-white">
      <div v-if="loading" class="p-6 text-center text-sm text-gray-400">Loading…</div>
      <div v-else-if="invoices.length === 0" class="p-8 text-center text-sm text-gray-400">
        No invoices yet.
      </div>
      <table v-else class="w-full text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-4 py-2">Date</th>
            <th class="px-4 py-2">Invoice #</th>
            <th class="px-4 py-2">Total</th>
            <th class="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="invoice in invoices" :key="invoice.id">
            <td class="px-4 py-2.5 text-gray-900">{{ new Date(invoice.created_at).toLocaleDateString() }}</td>
            <td class="px-4 py-2.5 text-gray-500">{{ invoice.invoice_number }}</td>
            <td class="px-4 py-2.5 text-gray-900">€{{ (invoice.total_cents / 100).toFixed(2) }}</td>
            <td class="px-4 py-2.5">
              <span class="rounded px-1.5 py-0.5 text-xs font-medium" :class="statusClass[invoice.status]">
                {{ invoice.status }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="!loading" class="rounded-lg border border-gray-200 bg-white p-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900">Account Credit</h3>
        <span class="text-sm font-medium" :class="creditLedgerCents > 0 ? 'text-green-600' : 'text-gray-500'">
          €{{ (creditLedgerCents / 100).toFixed(2) }} available
        </span>
      </div>

      <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="addCredit">
        <div>
          <label class="block text-xs text-gray-600">Add credit (€)</label>
          <input v-model="addCreditAmount" type="number" min="0" step="0.01" class="mt-0.5 w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
        </div>
        <div class="flex-1">
          <label class="block text-xs text-gray-600">Reason</label>
          <input v-model="addCreditReason" type="text" placeholder="e.g. Birthday gift" class="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
        </div>
        <button type="submit" :disabled="!addCreditAmount || addingCredit" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ addingCredit ? 'Adding…' : 'Add Credit' }}
        </button>
      </form>

      <form v-if="creditLedgerCents > 0 && unpaidInvoices.length > 0" class="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3" @submit.prevent="applyCreditToInvoice">
        <div>
          <label class="block text-xs text-gray-600">Apply to invoice</label>
          <select v-model="applyCreditInvoiceId" class="mt-0.5 rounded border border-gray-300 px-2 py-1 text-sm">
            <option value="" disabled>Select invoice…</option>
            <option v-for="inv in unpaidInvoices" :key="inv.id" :value="inv.id">{{ inv.invoice_number }} (€{{ (inv.total_cents / 100).toFixed(2) }})</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-600">Amount (€)</label>
          <input v-model="applyCreditAmount" type="number" min="0" step="0.01" class="mt-0.5 w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
        </div>
        <button type="submit" :disabled="!applyCreditInvoiceId || !applyCreditAmount || applyingCredit" class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {{ applyingCredit ? 'Applying…' : 'Apply Credit' }}
        </button>
      </form>

      <p v-if="creditError" class="mt-2 text-xs text-red-600">{{ creditError }}</p>

      <ul v-if="creditHistory.length > 0" class="mt-3 space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-500">
        <li v-for="c in creditHistory" :key="c.id">
          {{ new Date(c.created_at).toLocaleDateString() }} &middot;
          <span :class="c.amount_cents > 0 ? 'text-green-600' : 'text-red-600'">{{ c.amount_cents > 0 ? '+' : '' }}€{{ (c.amount_cents / 100).toFixed(2) }}</span>
          <span v-if="c.reason"> &middot; {{ c.reason }}</span>
        </li>
      </ul>
    </div>

    <div v-if="!loading" class="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3">
      <div>
        <p class="text-sm font-medium text-gray-900">Stripe card</p>
        <p class="text-xs text-gray-500">
          {{ hasCard ? 'Card on file — packages and memberships can be billed automatically.' : 'No card saved yet. Needed to set up autopay.' }}
        </p>
      </div>
      <button type="button" class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50" @click="showCardModal = true">
        {{ hasCard ? 'Replace card' : 'Add card' }}
      </button>
    </div>

    <div v-if="!loading">
      <h3 class="text-sm font-semibold text-gray-900">Packages / Bonos</h3>
      <div class="mt-2 space-y-2">
        <div v-for="p in purchases" :key="p.id" class="rounded-lg border border-gray-200 bg-white p-3">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-900">{{ p.package_name }}</p>
              <p class="text-xs text-gray-500">
                {{ p.sessions_used }} / {{ p.sessions_total }} sessions used · €{{ (p.price_cents / 100).toFixed(2) }} ·
                purchased {{ new Date(p.purchased_at).toLocaleDateString() }}
              </p>
            </div>
            <button
              type="button"
              :disabled="p.sessions_used >= p.sessions_total"
              class="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              @click="useSession(p)"
            >
              Log session used
            </button>
          </div>

          <div v-if="scheduleForPackage(p.id)" class="mt-2 flex items-center justify-between rounded-md bg-gray-50 px-2.5 py-1.5">
            <span class="text-xs text-gray-700">
              Stripe autopay:
              <span class="rounded px-1.5 py-0.5 text-xs font-medium" :class="scheduleStatusClass[scheduleForPackage(p.id)!.status]">{{ scheduleForPackage(p.id)!.status }}</span>
              {{ scheduleForPackage(p.id)!.installments_paid }} / {{ scheduleForPackage(p.id)!.installments_total }} paid
            </span>
            <button
              v-if="scheduleForPackage(p.id)!.status === 'active'"
              type="button"
              class="text-xs text-red-600 hover:underline"
              @click="cancelAutopay(scheduleForPackage(p.id)!.id)"
            >
              Cancel
            </button>
          </div>
          <div v-else-if="hasCard" class="mt-2">
            <button v-if="autopayFormFor !== p.id" type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-700" @click="openAutopayForm(p.id)">
              Set up Stripe autopay
            </button>
            <form v-else class="mt-1 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2" @submit.prevent="setUpPackageAutopay(p)">
              <div>
                <label class="block text-xs text-gray-600">Installments</label>
                <input v-model.number="autopayInstallments" type="number" min="1" class="mt-0.5 w-16 rounded border border-gray-300 px-2 py-1 text-xs" />
              </div>
              <div>
                <label class="block text-xs text-gray-600">Every</label>
                <input v-model.number="autopayIntervalCount" type="number" min="1" class="mt-0.5 w-14 rounded border border-gray-300 px-2 py-1 text-xs" />
              </div>
              <div>
                <label class="block text-xs text-gray-600">&nbsp;</label>
                <select v-model="autopayInterval" class="mt-0.5 rounded border border-gray-300 px-2 py-1 text-xs">
                  <option value="day">day(s)</option>
                  <option value="week">week(s)</option>
                  <option value="month">month(s)</option>
                  <option value="year">year(s)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs text-gray-600">Already paid</label>
                <input v-model.number="autopayAlreadyPaid" type="number" min="0" class="mt-0.5 w-16 rounded border border-gray-300 px-2 py-1 text-xs" />
              </div>
              <button type="submit" :disabled="settingUpAutopay" class="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {{ settingUpAutopay ? 'Setting up…' : 'Start' }}
              </button>
              <button type="button" class="text-xs text-gray-500 hover:underline" @click="autopayFormFor = null">Cancel</button>
              <p v-if="autopayError" class="w-full text-xs text-red-600">{{ autopayError }}</p>
            </form>
          </div>
        </div>
        <p v-if="purchases.length === 0" class="text-sm text-gray-400">No packages purchased.</p>
      </div>
      <form class="mt-2 flex flex-wrap items-end gap-2" @submit.prevent="sellPackage">
        <select v-model="sellPackageId" class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option value="" disabled>Sell a package…</option>
          <option v-for="t in packageTemplates" :key="t.id" :value="t.id">{{ t.name }} ({{ t.session_count }} sessions, €{{ (t.price_cents / 100).toFixed(2) }})</option>
        </select>
        <button type="submit" :disabled="!sellPackageId || sellingPackage" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ sellingPackage ? 'Selling…' : 'Sell' }}
        </button>
      </form>
    </div>

    <div v-if="!loading">
      <h3 class="text-sm font-semibold text-gray-900">Memberships</h3>
      <div class="mt-2 space-y-2">
        <div v-for="m in patientMemberships" :key="m.id" class="rounded-lg border border-gray-200 bg-white p-3">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-900">
                {{ m.membership_name }}
                <span class="ml-1 rounded px-1.5 py-0.5 text-xs font-medium" :class="statusClass[m.status]">{{ m.status }}</span>
              </p>
              <p class="text-xs text-gray-500">€{{ (m.price_cents / 100).toFixed(2) }} / period · started {{ new Date(m.started_at).toLocaleDateString() }}</p>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" class="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50" @click="logPayment(m, 'paid')">Log payment</button>
              <button type="button" class="rounded-md border border-gray-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50" @click="logPayment(m, 'failed')">Log failed</button>
              <select
                :value="m.status"
                class="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                @change="setMembershipStatus(m, ($event.target as HTMLSelectElement).value)"
              >
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="cancelled">cancelled</option>
              </select>
            </div>
          </div>
          <div v-if="paymentsFor(m.id).length > 0" class="mt-2 flex flex-wrap gap-1.5">
            <span
              v-for="pay in paymentsFor(m.id)"
              :key="pay.id"
              class="rounded px-1.5 py-0.5 text-xs font-medium"
              :class="pay.status === 'paid' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'"
            >
              {{ new Date(pay.period_start).toLocaleDateString('default', { month: 'short', year: 'numeric' }) }}: {{ pay.status }}
            </span>
          </div>

          <div v-if="scheduleForMembership(m.id)" class="mt-2 flex items-center justify-between rounded-md bg-gray-50 px-2.5 py-1.5">
            <span class="text-xs text-gray-700">
              Stripe autopay:
              <span class="rounded px-1.5 py-0.5 text-xs font-medium" :class="scheduleStatusClass[scheduleForMembership(m.id)!.status]">{{ scheduleForMembership(m.id)!.status }}</span>
              every {{ scheduleForMembership(m.id)!.interval_count }} {{ scheduleForMembership(m.id)!.interval }}(s) ·
              {{ eventsForSchedule(scheduleForMembership(m.id)!.id).length }} charge(s) so far
            </span>
            <button
              v-if="scheduleForMembership(m.id)!.status === 'active'"
              type="button"
              class="text-xs text-red-600 hover:underline"
              @click="cancelAutopay(scheduleForMembership(m.id)!.id)"
            >
              Cancel
            </button>
          </div>
          <div v-else-if="hasCard" class="mt-2">
            <button v-if="autopayFormFor !== m.id" type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-700" @click="openAutopayForm(m.id)">
              Set up Stripe autopay
            </button>
            <form v-else class="mt-1 flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2" @submit.prevent="setUpMembershipAutopay(m)">
              <div>
                <label class="block text-xs text-gray-600">Every</label>
                <input v-model.number="autopayIntervalCount" type="number" min="1" class="mt-0.5 w-14 rounded border border-gray-300 px-2 py-1 text-xs" />
              </div>
              <div>
                <label class="block text-xs text-gray-600">&nbsp;</label>
                <select v-model="autopayInterval" class="mt-0.5 rounded border border-gray-300 px-2 py-1 text-xs">
                  <option value="day">day(s)</option>
                  <option value="week">week(s)</option>
                  <option value="month">month(s)</option>
                  <option value="year">year(s)</option>
                </select>
              </div>
              <button type="submit" :disabled="settingUpAutopay" class="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {{ settingUpAutopay ? 'Setting up…' : 'Start' }}
              </button>
              <button type="button" class="text-xs text-gray-500 hover:underline" @click="autopayFormFor = null">Cancel</button>
              <p v-if="autopayError" class="w-full text-xs text-red-600">{{ autopayError }}</p>
            </form>
          </div>
        </div>
        <p v-if="patientMemberships.length === 0" class="text-sm text-gray-400">No memberships.</p>
      </div>
      <form class="mt-2 flex flex-wrap items-end gap-2" @submit.prevent="activateMembership">
        <select v-model="activateMembershipId" class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
          <option value="" disabled>Activate a membership…</option>
          <option v-for="t in membershipTemplates" :key="t.id" :value="t.id">{{ t.name }} (€{{ (t.price_cents / 100).toFixed(2) }})</option>
        </select>
        <button type="submit" :disabled="!activateMembershipId || activatingMembership" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ activatingMembership ? 'Activating…' : 'Activate' }}
        </button>
      </form>
    </div>

    <PatientsStripeCardModal
      v-if="showCardModal"
      :patient-id="patientId"
      @close="showCardModal = false"
      @saved="showCardModal = false; loadAll()"
    />
  </div>
</template>
