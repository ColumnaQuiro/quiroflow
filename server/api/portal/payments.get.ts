import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'
import { APP_PAY_PAST_DAYS, APP_VISIT_COLUMNS, appPaymentsAccount, appVisitCharge, hasLiveBono, payerCard } from '~/server/utils/appPayments'

// What the patient app needs to offer payments for one patient: whether the
// clinic lets them pay visits from the app, the card on file (brand and last
// four, read live from Stripe for the reason card-details.post.ts gives), and
// for each upcoming or recent visit what paying it would cost -- worked out
// here because the practitioner's own prices and the clinic's Stripe settings
// are not the patient's to read.
//
// The patient is read through the caller's own client, so RLS decides
// whether this record is theirs.
export default defineEventHandler(async (event) => {
  const patientId = getQuery(event).patientId
  if (typeof patientId !== 'string' || !patientId) throw createError({ statusCode: 400, statusMessage: 'patientId is required' })

  const { supabase, user } = await requireAuthedUser(event)
  const { data: patient } = await supabase.from('patients').select('id, account_id').eq('id', patientId).maybeSingle()
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  const service = serverSupabaseServiceRole<Database>(event)
  const account = await appPaymentsAccount(service, patient.account_id)
  const enabled = !!account?.stripe_publishable_key && !!account.stripe_app_payments_enabled
  if (!account || !enabled) return { enabled: false, card: null, visits: [] }

  // Theirs, or -- for a family member with none -- the caller's own card.
  const { customer, owner: cardOwner } = await payerCard(service, patient.id, user.id, account.id)
  let card: { brand: string; last4: string; expMonth: number; expYear: number } | null = null
  if (customer?.default_payment_method_id) {
    try {
      const { stripe, options } = await stripeClientFor(event, account.id, account)
      const method = await stripe.paymentMethods.retrieve(customer.default_payment_method_id, undefined, options)
      if (method.card) card = { brand: method.card.brand, last4: method.card.last4, expMonth: method.card.exp_month, expYear: method.card.exp_year }
    } catch {
      // A detached card still leaves its id behind; the app then offers to add one.
    }
  }

  const since = new Date(Date.now() - APP_PAY_PAST_DAYS * 86_400_000).toISOString()
  const { data: visits } = await service
    .from('appointments')
    .select(APP_VISIT_COLUMNS)
    .eq('patient_id', patient.id)
    .gte('starts_at', since)
    .not('status', 'in', '(cancelled,no_show)')
    .is('deleted_at', null)
    .order('starts_at')
    .limit(20)
  const liveBono = await hasLiveBono(service, patient.id)
  const charges = await Promise.all((visits ?? []).map(async (v) => ({ id: v.id, charge: await appVisitCharge(service, v, { liveBono }) })))

  return {
    enabled: true,
    card,
    cardOwner,
    visits: charges
      .filter((c) => c.charge.state !== 'none')
      .map((c) => ({ appointmentId: c.id, state: c.charge.state as 'payable' | 'paid', amountCents: (c.charge as { amountCents: number }).amountCents })),
  }
})
