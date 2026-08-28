<script setup lang="ts">
// PracticeHub-style unified ledger: invoices (debit) and payments/credits
// (credit) merged into one chronological table, replacing the old separate
// "Invoices" table + "creditHistory" list. See the plan notes on why a
// payment row's own "Balance" is always "—" rather than a PH-style
// per-event remaining amount: unlike PH, payments.invoice_id here is
// permanently 1:1 at insert time (not null), so there's no "still
// unallocated" state for an individual payment to show.
import { normalizeSearchTerm } from '~/utils/searchText'

interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  total_cents: number
  created_at: string
}

const props = defineProps<{
  patientId: string
  invoices: InvoiceRow[]
  lineItemDescriptions: Record<string, string[]>
  creditLedgerCents: number
  sendingInvoiceId: string
  sendResultInvoiceId: string
  sendResultMessage: string
  canDeleteInvoices: boolean
  canWriteOff: boolean
}>()
const emit = defineEmits<{
  addCredit: []
  takePayment: []
  sendInvoice: [invoiceId: string]
  deleteInvoice: [invoiceId: string]
  writeOffInvoice: [invoiceId: string]
  creditsChanged: []
}>()

const supabase = useSupabaseClient()
const store = useAccountStore()

interface PaymentRow { id: string; invoice_id: string; amount_cents: number; method: string; paid_at: string }
interface CreditRow { id: string; amount_cents: number; reason: string | null; method: string | null; invoice_id: string | null; created_at: string }

const payments = ref<PaymentRow[]>([])
const credits = ref<CreditRow[]>([])
const loading = ref(true)
const expandedKey = ref<string | null>(null)
const menuOpen = ref(false)

// Re-fetches whenever the parent's invoices array is reassigned -- every
// mutation site (take payment, add/apply credit, sell package, delete
// invoice, etc.) already ends in the parent's loadAll(), which reassigns
// `invoices.value` to a new array, so this piggybacks on that signal instead
// of needing its own exposed refresh() wired up at every call site.
async function refresh() {
  loading.value = true
  const invoiceIds = props.invoices.map((i) => i.id)
  const [{ data: pays }, { data: creds }] = await Promise.all([
    invoiceIds.length > 0
      ? supabase.from('payments').select('id, invoice_id, amount_cents, method, paid_at').in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [] as PaymentRow[] }),
    supabase
      .from('account_credits')
      .select('id, amount_cents, reason, method, invoice_id, created_at')
      .eq('patient_id', props.patientId)
      .order('created_at', { ascending: true }),
  ])
  payments.value = pays ?? []
  credits.value = creds ?? []
  loading.value = false
}
watch(() => props.invoices, refresh, { immediate: true })

function money(cents: number) {
  const amount = (Math.abs(cents) / 100).toFixed(2)
  return `${cents < 0 ? '-' : ''}€${amount}`
}
function invoiceRefFor(id: string | null) {
  if (!id) return null
  return props.invoices.find((i) => i.id === id)?.invoice_number ?? '(deleted invoice)'
}

interface LedgerRow {
  key: string
  ref: string
  date: string
  description: string
  debitCents: number
  creditCents: number
  balanceText: string
  balanceTone: 'success' | 'danger' | 'neutral'
  voided: boolean
  invoiceId?: string
  invoiceOpenCents?: number
  detail: { label: string; value: string }[]
}

const rows = computed<LedgerRow[]>(() => {
  const invoiceRows: LedgerRow[] = props.invoices.map((inv) => {
    const paidForInvoice = payments.value.filter((p) => p.invoice_id === inv.id).reduce((sum, p) => sum + p.amount_cents, 0)
    const openCents = inv.total_cents - paidForInvoice
    const items = props.lineItemDescriptions[inv.id] ?? []
    return {
      key: `invoice-${inv.id}`,
      ref: inv.invoice_number,
      date: inv.created_at,
      description: inv.status === 'void' ? 'Invoice (void)' : 'Invoice',
      debitCents: inv.status === 'void' ? 0 : inv.total_cents,
      creditCents: 0,
      balanceText: inv.status === 'void' ? '—' : money(openCents),
      balanceTone: inv.status === 'void' ? 'neutral' : openCents > 0 ? 'danger' : 'neutral',
      voided: inv.status === 'void',
      invoiceId: inv.id,
      invoiceOpenCents: inv.status === 'void' ? 0 : openCents,
      detail: items.length > 0 ? items.map((d) => ({ label: 'Item', value: d })) : [{ label: 'Items', value: '—' }],
    }
  })

  const paymentRows: LedgerRow[] = payments.value.map((p) => ({
    key: `payment-${p.id}`,
    ref: '',
    date: p.paid_at,
    description: `Payment — ${p.method}`,
    debitCents: 0,
    creditCents: p.amount_cents,
    balanceText: '—',
    balanceTone: 'neutral' as const,
    voided: false,
    detail: [
      { label: 'Method', value: p.method },
      { label: 'Applied to', value: invoiceRefFor(p.invoice_id) ?? '—' },
    ],
  }))

  // Credit-ledger rows show a running balance of that sub-ledger only --
  // labeled precisely so it isn't mistaken for PH's per-event remaining
  // amount (we have no allocation table tracking which top-up funded which
  // later spend).
  let creditRunning = 0
  const creditRows: LedgerRow[] = credits.value.map((c) => {
    creditRunning += c.amount_cents
    return {
      key: `credit-${c.id}`,
      ref: '',
      date: c.created_at,
      description: c.reason ?? 'Account credit',
      debitCents: c.amount_cents < 0 ? -c.amount_cents : 0,
      creditCents: c.amount_cents > 0 ? c.amount_cents : 0,
      balanceText: `${money(creditRunning)} ledger bal.`,
      balanceTone: creditRunning < 0 ? ('danger' as const) : ('neutral' as const),
      voided: false,
      detail: [
        ...(c.method ? [{ label: 'Method', value: c.method }] : []),
        ...(c.invoice_id ? [{ label: 'Linked invoice', value: invoiceRefFor(c.invoice_id) ?? '—' }] : []),
      ],
    }
  })

  // Payments/credits don't carry their own reference number -- assign one
  // per kind in chronological order (oldest = 1) before sorting the merged
  // list newest-first for display.
  const withSyntheticRefs = (list: LedgerRow[], prefix: string) =>
    [...list]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((row, i) => ({ ...row, ref: `${prefix}-${i + 1}` }))

  const allRows = [...invoiceRows, ...withSyntheticRefs(paymentRows, 'PAY'), ...withSyntheticRefs(creditRows, 'CR')]
  return allRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
})

function toggleExpanded(key: string) {
  expandedKey.value = expandedKey.value === key ? null : key
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
function newInvoice() {
  menuOpen.value = false
  navigateTo(`/billing/new?patient_id=${props.patientId}`)
}
function addCredit() {
  menuOpen.value = false
  emit('addCredit')
}
function takePayment() {
  menuOpen.value = false
  emit('takePayment')
}

// --- Write-off: settles an invoice's remaining balance without collecting
// money, via the parent (which owns the `invoices` array and the same
// paidCents->status flip logic used by every other payment path). ---------
function writeOffInvoice(invoiceId: string) {
  menuOpen.value = false
  emit('writeOffInvoice', invoiceId)
}

// --- Transfer credit: moves an amount from this patient's credit ledger to
// another patient's (e.g. a cancelled package's refund redirected to a
// family member) -- a linked pair of account_credits rows, mirroring the
// existing package-sharing search pattern in BillingTab.vue. ---------------
interface PatientOption { id: string; first_name: string; last_name: string | null }
const transferModalOpen = ref(false)
const transferSearch = ref('')
const transferResults = ref<PatientOption[]>([])
const transferTarget = ref<PatientOption | null>(null)
const transferAmount = ref('')
const transferring = ref(false)
const transferError = ref('')
let transferDebounce: ReturnType<typeof setTimeout> | undefined

function openTransferCredit() {
  menuOpen.value = false
  transferModalOpen.value = true
  transferSearch.value = ''
  transferResults.value = []
  transferTarget.value = null
  transferAmount.value = ''
  transferError.value = ''
}
watch(transferSearch, (value) => {
  clearTimeout(transferDebounce)
  if (!value.trim()) {
    transferResults.value = []
    return
  }
  transferDebounce = setTimeout(async () => {
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .neq('id', props.patientId)
      .ilike('search_name', `%${normalizeSearchTerm(value.trim())}%`)
      .limit(8)
    transferResults.value = data ?? []
  }, 250)
})
function selectTransferTarget(patient: PatientOption) {
  transferTarget.value = patient
  transferSearch.value = ''
  transferResults.value = []
}
async function submitTransferCredit() {
  transferError.value = ''
  if (!transferTarget.value) return
  const amountCents = Math.round((parseFloat(transferAmount.value) || 0) * 100)
  if (amountCents <= 0 || amountCents > props.creditLedgerCents) {
    transferError.value = 'Amount must be positive and not exceed available credit.'
    return
  }
  transferring.value = true
  const targetName = `${transferTarget.value.first_name} ${transferTarget.value.last_name ?? ''}`.trim()
  await supabase.from('account_credits').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    amount_cents: -amountCents,
    reason: `Transferred to ${targetName}`,
    created_by: store.teamMember?.id ?? null,
  })
  await supabase.from('account_credits').insert({
    account_id: store.accountId!,
    patient_id: transferTarget.value.id,
    amount_cents: amountCents,
    reason: 'Transferred credit',
    created_by: store.teamMember?.id ?? null,
  })
  transferring.value = false
  transferModalOpen.value = false
  await refresh()
  emit('creditsChanged')
}

// --- Statement: a PDF of this whole ledger, mirroring the invoice
// download/send pattern (pages/billing/[id].vue, server/utils/invoiceData.ts). ---
const statementSending = ref(false)
const statementMessage = ref('')
async function downloadStatement() {
  menuOpen.value = false
  const blob = await useStaffFetch<Blob>(`/api/patients/${props.patientId}/statement`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `statement-${props.patientId}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
async function sendStatement() {
  menuOpen.value = false
  statementSending.value = true
  statementMessage.value = ''
  try {
    await useStaffFetch(`/api/patients/${props.patientId}/statement/send`, { method: 'POST' })
    statementMessage.value = 'Statement emailed.'
  } catch (e: any) {
    statementMessage.value = e?.data?.message ?? 'Failed to send statement.'
  }
  statementSending.value = false
  setTimeout(() => (statementMessage.value = ''), 4000)
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card">
    <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
      <p class="text-[13.5px] font-semibold text-ink-700">Account Ledger</p>
      <div class="flex items-center gap-2">
        <span v-if="statementMessage" class="text-[12px] text-ink-faint">{{ statementMessage }}</span>
        <div class="relative">
          <button type="button" class="rounded-ctlSm px-1.5 py-1 text-ink-faint hover:bg-surface-subtle hover:text-ink-700" @click="menuOpen = !menuOpen">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          <div v-if="menuOpen" class="absolute right-0 z-10 mt-1 w-44 rounded-ctl border border-line bg-surface py-1 shadow-popover">
            <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="newInvoice">New Invoice</button>
            <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="takePayment">New Payment</button>
            <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="addCredit">Add Credit</button>
            <button v-if="creditLedgerCents > 0" type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="openTransferCredit">
              Transfer Credit
            </button>
            <div class="my-1 border-t border-line-divider"></div>
            <button type="button" class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle" @click="downloadStatement">Download Statement</button>
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-[12.5px] text-ink-700 hover:bg-surface-subtle disabled:opacity-50"
              :disabled="statementSending"
              @click="sendStatement"
            >
              {{ statementSending ? 'Sending…' : 'Send Statement' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="p-8 text-center text-[13px] text-ink-faint">Loading…</div>
    <div v-else-if="rows.length === 0" class="p-8 text-center text-[13px] text-ink-faint">No transactions yet.</div>
    <div v-else class="max-h-[420px] overflow-y-auto">
      <table class="w-full text-[13px]">
        <thead class="sticky top-0 border-b border-line-divider bg-surface text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          <tr>
            <th class="w-6 px-2 py-2"></th>
            <th class="px-2 py-2">Ref</th>
            <th class="px-2 py-2">Date</th>
            <th class="px-2 py-2">Description</th>
            <th class="px-2 py-2 text-right">Debit</th>
            <th class="px-2 py-2 text-right">Credit</th>
            <th class="px-4 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line-row">
          <template v-for="row in rows" :key="row.key">
            <tr class="h-[42px] cursor-pointer hover:bg-surface-subtle" :class="row.voided ? 'opacity-60' : ''" @click="toggleExpanded(row.key)">
              <td class="px-2 text-ink-faint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="transition-transform" :class="expandedKey === row.key ? 'rotate-90' : ''">
                  <path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </td>
              <td class="px-2 font-mono text-[12px] text-ink-muted">{{ row.ref }}</td>
              <td class="px-2 text-ink-muted">{{ formatDate(row.date) }}</td>
              <td class="px-2 text-ink-700">{{ row.description }}</td>
              <td class="px-2 text-right font-mono text-ink-700">{{ row.debitCents > 0 ? money(row.debitCents) : '' }}</td>
              <td class="px-2 text-right font-mono text-success-text">{{ row.creditCents > 0 ? money(row.creditCents) : '' }}</td>
              <td class="px-4 text-right font-mono" :class="row.balanceTone === 'danger' ? 'text-danger-text' : 'text-ink-muted'">{{ row.balanceText }}</td>
            </tr>
            <tr v-if="expandedKey === row.key">
              <td colspan="7" class="bg-surface-subtle px-8 py-3">
                <dl class="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
                  <template v-for="(d, i) in row.detail" :key="i">
                    <dt class="text-ink-faint">{{ d.label }}</dt>
                    <dd class="text-ink-muted2">{{ d.value }}</dd>
                  </template>
                </dl>
                <div v-if="row.invoiceId" class="mt-2 flex items-center gap-3 border-t border-line-divider pt-2 text-[12px]">
                  <NuxtLink :to="`/billing/${row.invoiceId}`" class="font-medium text-brand-text hover:text-brand-hover">Open invoice</NuxtLink>
                  <span v-if="sendResultInvoiceId === row.invoiceId" class="text-ink-faint">{{ sendResultMessage }}</span>
                  <button
                    v-else
                    type="button"
                    class="text-ink-faint hover:text-brand-text disabled:opacity-50"
                    :disabled="sendingInvoiceId === row.invoiceId"
                    @click="emit('sendInvoice', row.invoiceId)"
                  >
                    {{ sendingInvoiceId === row.invoiceId ? 'Sending…' : 'Email invoice' }}
                  </button>
                  <button v-if="canDeleteInvoices" type="button" class="text-ink-faint hover:text-danger-text" @click="emit('deleteInvoice', row.invoiceId)">Delete</button>
                  <button
                    v-if="canWriteOff && !row.voided && (row.invoiceOpenCents ?? 0) > 0"
                    type="button"
                    class="text-ink-faint hover:text-warning-text"
                    @click="writeOffInvoice(row.invoiceId)"
                  >
                    Write off {{ money(row.invoiceOpenCents ?? 0) }}
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="transferModalOpen" class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/40 p-4" @click.self="transferModalOpen = false">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-4 shadow-popover">
      <p class="text-[13.5px] font-semibold text-ink-700">Transfer credit</p>
      <p class="mt-1 text-[12px] text-ink-faint">Moves an amount from this patient's credit (€{{ (creditLedgerCents / 100).toFixed(2) }} available) to another patient's account.</p>

      <div class="mt-3">
        <label class="block text-[11px] text-ink-muted">To patient</label>
        <div v-if="transferTarget" class="mt-0.5 flex items-center justify-between rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]">
          <span>{{ transferTarget.first_name }} {{ transferTarget.last_name }}</span>
          <button type="button" class="text-ink-faint hover:text-danger-text" @click="transferTarget = null">✕</button>
        </div>
        <div v-else class="relative mt-0.5">
          <input
            v-model="transferSearch"
            type="text"
            placeholder="Search a patient…"
            class="w-full rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]"
          />
          <ul v-if="transferResults.length" class="absolute z-10 mt-1 w-full rounded-ctlSm border border-line bg-surface shadow-popover">
            <li
              v-for="p in transferResults"
              :key="p.id"
              class="cursor-pointer px-2 py-1.5 text-[13px] text-ink-700 hover:bg-surface-subtle"
              @click="selectTransferTarget(p)"
            >
              {{ p.first_name }} {{ p.last_name }}
            </li>
          </ul>
        </div>
      </div>

      <div class="mt-3">
        <label class="block text-[11px] text-ink-muted">Amount (€)</label>
        <input v-model="transferAmount" type="number" min="0" step="0.01" class="mt-0.5 w-32 rounded-ctlSm border border-line-control px-2 py-1.5 text-[13px]" />
      </div>

      <p v-if="transferError" class="mt-2 text-[12px] text-danger-text">{{ transferError }}</p>

      <div class="mt-4 flex items-center justify-end gap-2">
        <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="transferModalOpen = false">Cancel</button>
        <UiBtn variant="primary" size="sm" :disabled="!transferTarget || !transferAmount || transferring" @click="submitTransferCredit">
          {{ transferring ? 'Transferring…' : 'Transfer' }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>
