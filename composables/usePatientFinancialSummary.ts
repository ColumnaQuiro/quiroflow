interface ActiveMembership {
  id: string
  membership_name: string
  status: string
}
interface ActivePackage {
  id: string
  package_name: string
  sessions_total: number
  sessions_used: number
  price_cents: number
  shared?: boolean
}

interface FinancialState {
  loading: Ref<boolean>
  balanceCents: Ref<number>
  creditLedgerCents: Ref<number>
  activeMembership: Ref<ActiveMembership | null>
  activePackages: Ref<ActivePackage[]>
}

// Keyed by patient id and shared across every call site (patient detail page,
// its sidebar, the Billing tab, the calendar's appointment modal/hover card,
// mobile) -- without this each call created its own private refs, so e.g.
// recording a payment in the Billing tab refreshed only that tab's own copy
// and the sidebar's balance stayed stale until a full page reload.
const cache = new Map<string, FinancialState>()

function stateFor(id: string | null | undefined): FinancialState {
  const key = id || '__none__'
  let state = cache.get(key)
  if (!state) {
    state = {
      loading: ref(true),
      balanceCents: ref(0),
      creditLedgerCents: ref(0),
      activeMembership: ref(null),
      activePackages: ref([]),
    }
    cache.set(key, state)
  }
  return state
}

export function usePatientFinancialSummary(patientId: MaybeRefOrGetter<string>) {
  const supabase = useSupabaseClient()
  const id = computed(() => toValue(patientId))

  async function load() {
    const currentId = id.value
    if (!currentId) return
    const state = stateFor(currentId)
    state.loading.value = true

    const [{ data: invoices }, { data: memberships }, { data: packages }, { data: credits }, { data: shares }] = await Promise.all([
      supabase.from('invoices').select('id, total_cents').eq('patient_id', currentId).neq('status', 'void'),
      supabase.from('patient_memberships').select('id, membership_name, status').eq('patient_id', currentId).eq('status', 'active'),
      supabase.from('package_purchases').select('id, package_name, sessions_total, sessions_used, price_cents').eq('patient_id', currentId).order('purchased_at', { ascending: false }),
      supabase.from('account_credits').select('amount_cents').eq('patient_id', currentId),
      supabase.from('package_purchase_shares').select('package_purchases(id, package_name, sessions_total, sessions_used, price_cents)').eq('patient_id', currentId),
    ])

    const invoiceIds = (invoices ?? []).map((i) => i.id)
    let paidCents = 0
    if (invoiceIds.length > 0) {
      const { data: payments } = await supabase.from('payments').select('amount_cents').in('invoice_id', invoiceIds)
      paidCents = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
    }
    const invoicedCents = (invoices ?? []).reduce((sum, i) => sum + i.total_cents, 0)
    state.creditLedgerCents.value = (credits ?? []).reduce((sum, c) => sum + c.amount_cents, 0)
    // Positive = clinic owes the patient (credit), negative = patient owes the clinic --
    // matches the sign convention already used for patients.balance_cents elsewhere,
    // but computed live from invoices/payments rather than trusting that column, which
    // is only ever written at import time and never kept in sync afterward.
    state.balanceCents.value = paidCents - invoicedCents + state.creditLedgerCents.value

    state.activeMembership.value = memberships?.[0] ?? null
    // Packages are pure session-count tracking (name, sessions left) -- the
    // money a package purchase is worth lives in the real credit ledger
    // (account_credits, folded into balanceCents above) as soon as it's
    // paid for, and gets spent for real (a payment + a matching negative
    // account_credits row) each time a session is used against it. There's
    // deliberately no separate "unallocated value" computed from price
    // pro-rated by sessions left -- that number never matched what the
    // patient actually paid, and didn't move in step with real spend.
    const sharedPackages = (shares ?? [])
      .map((s) => s.package_purchases)
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => ({ ...p, shared: true }))
    state.activePackages.value = [...(packages ?? []), ...sharedPackages].filter((p) => p.sessions_used < p.sessions_total)

    state.loading.value = false
  }

  onMounted(load)
  watch(id, load)

  return {
    loading: computed(() => stateFor(id.value).loading.value),
    balanceCents: computed(() => stateFor(id.value).balanceCents.value),
    creditLedgerCents: computed(() => stateFor(id.value).creditLedgerCents.value),
    activeMembership: computed(() => stateFor(id.value).activeMembership.value),
    activePackages: computed(() => stateFor(id.value).activePackages.value),
    refresh: load,
  }
}
