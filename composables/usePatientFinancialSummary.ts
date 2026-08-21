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
}

export function usePatientFinancialSummary(patientId: MaybeRefOrGetter<string>) {
  const supabase = useSupabaseClient()
  const id = computed(() => toValue(patientId))

  const loading = ref(true)
  // Positive = clinic owes the patient (credit), negative = patient owes the clinic —
  // matches the sign convention already used for patients.balance_cents elsewhere,
  // but computed live from invoices/payments rather than trusting that column, which
  // is only ever written at import time and never kept in sync afterward.
  const balanceCents = ref(0)
  const creditLedgerCents = ref(0)
  const activeMembership = ref<ActiveMembership | null>(null)
  const activePackages = ref<ActivePackage[]>([])

  async function load() {
    if (!id.value) return
    loading.value = true

    const [{ data: invoices }, { data: memberships }, { data: packages }, { data: credits }] = await Promise.all([
      supabase.from('invoices').select('id, total_cents').eq('patient_id', id.value).neq('status', 'void'),
      supabase.from('patient_memberships').select('id, membership_name, status').eq('patient_id', id.value).eq('status', 'active'),
      supabase.from('package_purchases').select('id, package_name, sessions_total, sessions_used').eq('patient_id', id.value),
      supabase.from('account_credits').select('amount_cents').eq('patient_id', id.value),
    ])

    const invoiceIds = (invoices ?? []).map((i) => i.id)
    let paidCents = 0
    if (invoiceIds.length > 0) {
      const { data: payments } = await supabase.from('payments').select('amount_cents').in('invoice_id', invoiceIds)
      paidCents = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0)
    }
    const invoicedCents = (invoices ?? []).reduce((sum, i) => sum + i.total_cents, 0)
    creditLedgerCents.value = (credits ?? []).reduce((sum, c) => sum + c.amount_cents, 0)
    balanceCents.value = paidCents - invoicedCents + creditLedgerCents.value

    activeMembership.value = memberships?.[0] ?? null
    activePackages.value = (packages ?? []).filter((p) => p.sessions_used < p.sessions_total)

    loading.value = false
  }

  onMounted(load)
  watch(id, load)

  return { loading, balanceCents, creditLedgerCents, activeMembership, activePackages, refresh: load }
}
