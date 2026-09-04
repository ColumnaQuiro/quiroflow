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
  // Tracks whether a load has ever completed (or is in flight) for this id --
  // every call site (patient detail page, its sidebar, the Billing tab, the
  // calendar's appointment modal/hover card, mobile) used to trigger its own
  // onMounted(load), so opening a patient and then switching to its Billing
  // tab re-ran this same set of queries from scratch a second time even
  // though the first call's data was still fresh. Now onMounted only loads
  // once per id; refresh() (called after an actual write) still forces a
  // real reload.
  loaded: boolean
  inFlight: Promise<void> | null
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
      loaded: false,
      inFlight: null,
    }
    cache.set(key, state)
  }
  return state
}

export function usePatientFinancialSummary(patientId: MaybeRefOrGetter<string>) {
  const supabase = useSupabaseClient()
  const id = computed(() => toValue(patientId))

  async function doLoad(currentId: string) {
    const state = stateFor(currentId)
    state.loading.value = true

    // payments has no patient_id of its own -- joined through invoices the
    // same way BillingTab's loadAll() already joins invoice_line_items and
    // membership_payments, instead of a first round-trip for invoice ids
    // and a second `in()` query for their payments. That second hop was a
    // guaranteed extra network round-trip on every single load.
    const [{ data: invoices }, { data: memberships }, { data: packages }, { data: credits }, { data: shares }, { data: payments }] = await Promise.all([
      supabase.from('invoices').select('id, total_cents').eq('patient_id', currentId).neq('status', 'void'),
      supabase.from('patient_memberships').select('id, membership_name, status').eq('patient_id', currentId).eq('status', 'active'),
      supabase.from('package_purchases').select('id, package_name, sessions_total, sessions_used, price_cents').eq('patient_id', currentId).order('purchased_at', { ascending: false }),
      supabase.from('account_credits').select('amount_cents').eq('patient_id', currentId),
      supabase.from('package_purchase_shares').select('package_purchases(id, package_name, sessions_total, sessions_used, price_cents)').eq('patient_id', currentId),
      supabase.from('payments').select('amount_cents, invoices!inner(patient_id)').eq('invoices.patient_id', currentId),
    ])

    const paidCents = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
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
    state.loaded = true
  }

  // Forces a fresh load regardless of cache state -- what every write
  // (recording a payment, applying credit, buying a package...) calls
  // afterward so the numbers actually reflect what just happened.
  function refresh() {
    const currentId = id.value
    if (!currentId) return Promise.resolve()
    const state = stateFor(currentId)
    const promise = doLoad(currentId).finally(() => {
      if (state.inFlight === promise) state.inFlight = null
    })
    state.inFlight = promise
    return promise
  }

  // Mount-time load: reuses another call site's already-loaded (or
  // in-flight) data for the same id instead of re-querying, since this
  // composable is called independently from several places for the same
  // patient (see cache comment above).
  function loadIfNeeded() {
    const currentId = id.value
    if (!currentId) return
    const state = stateFor(currentId)
    if (state.loaded || state.inFlight) return
    refresh()
  }

  onMounted(loadIfNeeded)
  watch(id, loadIfNeeded)

  return {
    loading: computed(() => stateFor(id.value).loading.value),
    balanceCents: computed(() => stateFor(id.value).balanceCents.value),
    creditLedgerCents: computed(() => stateFor(id.value).creditLedgerCents.value),
    activeMembership: computed(() => stateFor(id.value).activeMembership.value),
    activePackages: computed(() => stateFor(id.value).activePackages.value),
    refresh,
  }
}
