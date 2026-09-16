import { bonoOwedCents } from '~/utils/bonoOwed'

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
  // Both needed to work out what is still owed on the bono, which comes off
  // its remaining value in bonoValueCents. Absent on a shared package, which
  // is excluded from that sum anyway.
  invoice_id?: string | null
  owed_cents?: number | null
  shared?: boolean
  // Set only on a shared package (shared: true) -- whose bono this actually
  // is, so a beneficiary's own billing view can say "shared by X" instead of
  // looking like a package this patient bought themselves.
  ownerName?: string
}

interface FinancialState {
  loading: Ref<boolean>
  balanceCents: Ref<number>
  creditLedgerCents: Ref<number>
  // Everything the patient has ever actually paid. Already summed here to
  // get balanceCents -- exposed because DetailSidebar's "Lifetime" figure is
  // exactly this number, and it was re-deriving it with its own invoices
  // query followed by a dependent payments query.
  lifetimeCents: Ref<number>
  // What the patient's unused bono sessions are worth, as money, net of what
  // is still owed on them. Since a bono visit stopped being a billing event
  // (0161), the sessions counter is the only record of remaining value --
  // there is no parallel credit balance to read it off any more. Staff still
  // need the figure in euros, because that is how PracticeHub shows it (its
  // `balance` column is the same sessions-left calculation) and how a patient
  // asks for it: "how much do I have left?". PracticeHub keeps the debt in a
  // second column (`package_balance`) rather than netting it off; here the
  // debt is netted off, because this figure feeds a single "available" pill
  // with nowhere to show a second number.
  bonoValueCents: Ref<number>
  // Loose account credit PLUS bono value: everything the patient can draw on.
  // A summary, not a second balance -- nothing spends from this figure, a
  // session still comes off its own counter and credit still off the ledger,
  // so showing it here cannot let the same value be spent twice.
  availableCents: Ref<number>
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
      lifetimeCents: ref(0),
      bonoValueCents: ref(0),
      availableCents: ref(0),
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

    // payments carries its own patient_id since 0170, so this reads the
    // patient's money directly instead of joining through invoices. That is
    // not just tidier: an inner join to invoices drops every payment with no
    // invoice_id, and money on account -- which is most of what PracticeHub
    // holds for a bono patient -- has none. The invoice is still joined, but
    // only for the status the credit-on-void rule below needs, and left outer
    // so an unallocated payment survives it.
    const [{ data: invoices }, { data: memberships }, { data: packages }, { data: credits }, { data: shares }, { data: payments }] = await Promise.all([
      // Void invoices are filtered in JS rather than here: bonoValueCents
      // below needs the bono's own sale invoice, and telling "no invoice"
      // apart from "an invoice that was voided" needs the status in hand.
      supabase.from('invoices').select('id, total_cents, status').eq('patient_id', currentId),
      supabase.from('patient_memberships').select('id, membership_name, status').eq('patient_id', currentId).eq('status', 'active'),
      supabase.from('package_purchases').select('id, package_name, sessions_total, sessions_used, price_cents, invoice_id, owed_cents').eq('patient_id', currentId).order('purchased_at', { ascending: false }),
      supabase.from('account_credits').select('amount_cents, external_reference').eq('patient_id', currentId),
      supabase
        .from('package_purchase_shares')
        .select('package_purchases(id, package_name, sessions_total, sessions_used, price_cents, patients(first_name, last_name))')
        .eq('patient_id', currentId),
      supabase.from('payments').select('amount_cents, method, invoice_id, package_purchase_id, external_reference, purpose, invoices(status)').eq('patient_id', currentId),
    ])

    // A 'credit' payment against a VOIDED invoice is not money and never was:
    // it recorded a patient spending account credit, and the charge it settled
    // has since been cancelled. Counting it while the void invoice's debit is
    // dropped just above (.neq('status', 'void')) inflates the balance by the
    // payment amount -- 2,338.33 EUR across 44 patients when the historical
    // bono-session invoices were voided in bulk.
    //
    // Cash and card payments on a void invoice are deliberately still counted.
    // There the money really was collected and the charge really was cancelled,
    // so the clinic really does owe it back and the resulting credit is honest
    // -- that is the case pages/billing/[id].vue now refuses to create, and
    // hiding it here would bury real over-collection instead of surfacing it.
    const countablePayments = (payments ?? []).filter((p) => {
      const status = (p as unknown as { invoices: { status: string } | null }).invoices?.status
      return !(p.method === 'credit' && status === 'void')
    })

    const paidCents = countablePayments.reduce((sum, p) => sum + p.amount_cents, 0)
    state.lifetimeCents.value = paidCents
    // Money taken on account is the one kind of payment the balance must not
    // count, because the same euros are already in the credit ledger below:
    // adding credit writes a payment (the money arrived, and a factura says
    // so) and an account_credits row (what the patient can still direct
    // somewhere). Counting both put Adrian Oropeza 115 EUR ahead of himself.
    // Spending that credit later is a separate payment, method 'credit', and
    // that one does count -- it is matched by a negative credit row, so the
    // two moves cancel and the balance stays put while the money changes
    // hands. Lifetime above stays gross: it answers "how much has this person
    // paid us", where on-account money belongs.
    const paidForBalanceCents = countablePayments
      .filter((p) => (p as { purpose: string | null }).purpose !== 'on_account')
      .reduce((sum, p) => sum + p.amount_cents, 0)
    const liveInvoices = (invoices ?? []).filter((i) => i.status !== 'void')
    const invoicedCents = liveInvoices.reduce((sum, i) => sum + i.total_cents, 0)
    // The PracticeHub cutover wrote one negative entry per patient holding an
    // unused bono, to take that value off the balance -- PracticeHub carries a
    // bono as money on account, QuiroFlow carries it on the sessions counter,
    // and without the entry the same value would be counted in both places.
    //
    // It is a balance adjustment, not a reduction of spendable credit, and the
    // two are different things here: creditLedgerCents is what the patient can
    // actually draw on, and the balance pill adds it to the bono's value. Left
    // in, the entry cancelled most of the bono it was accounting for -- Esther
    // Tarancon's 473 EUR of sessions rendered as "17.00 in bonos", and 99 of
    // 197 bono holders showed no pill at all.
    const cutoverAdjustmentCents = (credits ?? [])
      .filter((c) => (c as { external_reference: string | null }).external_reference?.startsWith('bono-cutover-'))
      .reduce((sum, c) => sum + c.amount_cents, 0)
    state.creditLedgerCents.value = (credits ?? [])
      .filter((c) => !(c as { external_reference: string | null }).external_reference?.startsWith('bono-cutover-'))
      .reduce((sum, c) => sum + c.amount_cents, 0)
    // Positive = clinic owes the patient (credit), negative = patient owes the clinic --
    // matches the sign convention already used for patients.balance_cents elsewhere,
    // but computed live from invoices/payments rather than trusting that column, which
    // is only ever written at import time and never kept in sync afterward.
    state.balanceCents.value = paidForBalanceCents - invoicedCents + state.creditLedgerCents.value + cutoverAdjustmentCents

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
      .map(({ patients: owner, ...p }) => ({
        ...p,
        shared: true,
        ownerName: owner ? `${owner.first_name} ${owner.last_name ?? ''}`.trim() : undefined,
      }))
    state.activePackages.value = [...(packages ?? []), ...sharedPackages].filter((p) => p.sessions_used < p.sessions_total)

    // sessions_left x the bono's own per-session rate, with the same rounding
    // useSession() bills a visit at, so this figure and the session it pays for
    // can never disagree by a cent -- MINUS whatever is still owed on that
    // bono. Mirrors BillingTab.committedBonoCents.
    //
    // The subtraction is the whole point. Unused sessions exist whether or not
    // anyone has paid for them, so counting them gross says a patient can draw
    // on money they have not handed over: Adrian Oropeza put 150 EUR down on a
    // 528 EUR bono and the pill read "484 available" while the Debtors report,
    // reading the same purchase through utils/bonoOwed, listed him as owing
    // 378. Both numbers came out of this database on the same day. Net of the
    // debt he has 106 EUR -- which is exactly his balance, because 106 is what
    // he has actually paid beyond what he has been invoiced. Across the
    // account the gross figure overstated what patients could draw on by
    // 21,910 EUR on 86 bonos.
    //
    // Bonos shared FROM someone else are excluded: those sessions are the
    // owner's money, already labelled "Shared by" wherever they appear, and
    // counting them here would show the same euros on two patients at once.
    state.bonoValueCents.value = state.activePackages.value
      .filter((p) => !p.shared)
      .reduce((sum, p) => {
        if (!p.sessions_total) return sum
        const perSessionCents = Math.round(p.price_cents / p.sessions_total)
        const remainingCents = perSessionCents * Math.max(0, p.sessions_total - p.sessions_used)
        const saleInvoice = liveInvoices.find((i) => i.id === p.invoice_id)
        const owedCents = bonoOwedCents({
          purchaseId: p.id,
          invoiceId: p.invoice_id ?? null,
          priceCents: p.price_cents,
          owedCents: p.owed_cents ?? null,
          invoice: saleInvoice ? { status: saleInvoice.status, total_cents: saleInvoice.total_cents } : null,
          payments: (payments ?? []).map((pay) => ({
            amount_cents: pay.amount_cents,
            invoice_id: pay.invoice_id,
            package_purchase_id: pay.package_purchase_id,
            external_reference: pay.external_reference,
            purpose: (pay as { purpose: string | null }).purpose,
          })),
        })
        return sum + Math.max(0, remainingCents - owedCents)
      }, 0)
    state.availableCents.value = state.creditLedgerCents.value + state.bonoValueCents.value

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
    lifetimeCents: computed(() => stateFor(id.value).lifetimeCents.value),
    bonoValueCents: computed(() => stateFor(id.value).bonoValueCents.value),
    availableCents: computed(() => stateFor(id.value).availableCents.value),
    activeMembership: computed(() => stateFor(id.value).activeMembership.value),
    activePackages: computed(() => stateFor(id.value).activePackages.value),
    refresh,
  }
}
