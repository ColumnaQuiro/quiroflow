import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { suggestMandatePatient, type MatchablePatient } from '~/utils/gocardlessMatch'

// Settings > Import > GoCardless direct debits: every collectable mandate in
// the clinic's GoCardless account, whoever created it, with the patient it is
// matched to here or the one we suggest. GoCardless's partner checklist
// requires exactly this -- mandates set up outside the product must be
// importable, visible as matched or unmatched, and unmatchable.
//
// Also the subscriptions already running on each mandate. On a clinic coming
// from PracticeHub those are PracticeHub's, still collecting; QuiroFlow will
// not start its own on a mandate until they stop, or the patient pays twice.
// If GoCardless will not show us another app's subscriptions, the answer says
// so (`otherSubscriptionsKnown: false`) instead of claiming there are none.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'billing_config')
  setHeader(event, 'Cache-Control', 'no-store')
  const admin = serverSupabaseServiceRole<Database>(event)
  const request = await gocardlessForAccount(admin, teamMember.account_id)
  if (!request) throw createError({ statusCode: 409, statusMessage: 'GoCardless is not connected' })

  let mandates: GcMandate[]
  let customers: GcCustomer[]
  let bankAccounts: GcCustomerBankAccount[]
  try {
    ;[mandates, customers, bankAccounts] = await Promise.all([
      gocardlessListAll<GcMandate>(request, '/mandates', 'mandates', { status: 'pending_submission,submitted,active' }),
      gocardlessListAll<GcCustomer>(request, '/customers', 'customers'),
      gocardlessListAll<GcCustomerBankAccount>(request, '/customer_bank_accounts', 'customer_bank_accounts', { enabled: 'true' }),
    ])
  } catch (err) {
    if (err instanceof GoCardlessError && err.tokenGone) {
      await forgetGoCardlessConnection(admin, teamMember.account_id)
      throw createError({ statusCode: 409, statusMessage: 'GoCardless was disconnected from its own dashboard. Connect it again.' })
    }
    throw createError({ statusCode: 502, statusMessage: (err as Error).message })
  }

  let subscriptions: GcSubscription[] = []
  let otherSubscriptionsKnown = true
  try {
    subscriptions = await gocardlessListAll<GcSubscription>(request, '/subscriptions', 'subscriptions', { status: 'pending_customer_approval,customer_approval_denied,active,paused' })
  } catch (err) {
    console.error('[gocardless mandates] subscriptions not readable', (err as Error).message)
    otherSubscriptionsKnown = false
  }

  const [{ data: matched }, { data: patients }, { data: ours }] = await Promise.all([
    admin.from('patient_gocardless_mandates').select('gocardless_mandate_id, patient_id, matched_by').eq('account_id', teamMember.account_id),
    admin.from('patients').select('id, first_name, last_name, email, phone_search').eq('account_id', teamMember.account_id).neq('status', 'archived'),
    admin.from('payment_schedules').select('gocardless_subscription_id').eq('account_id', teamMember.account_id).not('gocardless_subscription_id', 'is', null),
  ])

  const customerById = new Map(customers.map((c) => [c.id, c]))
  const bankById = new Map(bankAccounts.map((b) => [b.id, b]))
  const matchedById = new Map((matched ?? []).map((m) => [m.gocardless_mandate_id, m]))
  const oursIds = new Set((ours ?? []).map((s) => s.gocardless_subscription_id))
  const patientList = (patients ?? []) as MatchablePatient[]
  const patientById = new Map(patientList.map((p) => [p.id, p]))

  return {
    otherSubscriptionsKnown,
    mandates: mandates.map((m) => {
      const customer = customerById.get(m.links.customer)
      const bank = bankById.get(m.links.customer_bank_account)
      const match = matchedById.get(m.id)
      const suggestion = !match && customer ? suggestMandatePatient(customer, patientList) : null
      const patientId = match?.patient_id ?? suggestion?.patientId ?? null
      const patient = patientId ? patientById.get(patientId) : null
      return {
        id: m.id,
        status: m.status,
        scheme: m.scheme,
        reference: m.reference,
        createdAt: m.created_at,
        nextPossibleChargeDate: m.next_possible_charge_date,
        customer: customer
          ? { name: [customer.given_name, customer.family_name].filter(Boolean).join(' ') || customer.company_name || '', email: customer.email }
          : null,
        bank: bank ? { name: bank.bank_name, ending: bank.account_number_ending } : null,
        matched: Boolean(match),
        patient: patient ? { id: patient.id, name: `${patient.first_name} ${patient.last_name ?? ''}`.trim() } : null,
        suggestedBy: match ? match.matched_by : (suggestion?.by ?? null),
        ambiguous: suggestion && 'ambiguous' in suggestion ? suggestion.ambiguous : false,
        subscriptions: subscriptions
          .filter((s) => s.links.mandate === m.id)
          .map((s) => ({
            id: s.id,
            name: s.name,
            status: s.status,
            amountCents: s.amount,
            intervalUnit: s.interval_unit,
            interval: s.interval,
            nextChargeDate: s.upcoming_payments?.[0]?.charge_date ?? null,
            ours: oursIds.has(s.id),
          })),
      }
    }),
  }
})
