import { serverSupabaseServiceRole } from '#supabase/server'
import type Stripe from 'stripe'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'
import { matchablePatients } from '~/server/utils/stripeMembershipSync'
import { suggestMandatePatient } from '~/utils/gocardlessMatch'
import { stripeAutoPairDecision, stripeCustomerAsMatchable, stripeSubscriptionState } from '~/utils/stripeMembershipSync'

// Settings > Import > Stripe subscriptions: every live subscription in the
// clinic's own Stripe account, the prices they charge (and the plan each is
// mapped to), and for each subscription the patient it is paired with here
// or the one suggested -- the same matcher GoCardless mandates use
// (utils/gocardlessMatch.ts). Read only: nothing is written until someone
// presses Import (import.post.ts).
//
// Subscriptions the Billing tab created itself (a Subscription Schedule of
// ours) are left out: they are already memberships here.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'billing_config')
  setHeader(event, 'Cache-Control', 'no-store')
  const accountId = teamMember.account_id
  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: account } = await admin.from('accounts').select('stripe_connect_account_id').eq('id', accountId).maybeSingle()
  if (!account) throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  const { stripe, options } = await stripeClientFor(event, accountId, account)

  const subscriptions: Stripe.Subscription[] = []
  try {
    for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer', 'data.items.data.price.product'] }, options)) {
      if (sub.status === 'canceled' || sub.status === 'incomplete_expired') continue
      subscriptions.push(sub)
      if (subscriptions.length >= 2000) break
    }
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: `Stripe: ${(err as Error).message}` })
  }

  const [{ data: schedules }, { data: maps }, { data: plans }, { data: customers }, patients] = await Promise.all([
    admin.from('payment_schedules').select('stripe_subscription_id, stripe_subscription_schedule_id, origin, patient_id').eq('account_id', accountId).eq('provider', 'stripe'),
    admin.from('stripe_membership_prices').select('stripe_price_id, membership_id').eq('account_id', accountId),
    admin.from('memberships').select('id, name, price_cents, billing_interval, billing_interval_count').eq('account_id', accountId).order('name'),
    admin.from('patient_stripe_customers').select('stripe_customer_id, patient_id').eq('account_id', accountId),
    matchablePatients(admin, accountId),
  ])

  const scheduleBySub = new Map((schedules ?? []).filter((s) => s.stripe_subscription_id).map((s) => [s.stripe_subscription_id!, s]))
  const oursBySchedule = new Set((schedules ?? []).filter((s) => s.origin === 'created_here' && s.stripe_subscription_schedule_id).map((s) => s.stripe_subscription_schedule_id!))
  const planByPrice = new Map((maps ?? []).map((m) => [m.stripe_price_id, m.membership_id]))
  const patientsByCustomer = new Map<string, string[]>()
  for (const c of customers ?? []) patientsByCustomer.set(c.stripe_customer_id, [...(patientsByCustomer.get(c.stripe_customer_id) ?? []), c.patient_id])
  const patientById = new Map(patients.map((p) => [p.id, p]))
  const nameOf = (id: string | null | undefined) => {
    const p = id ? patientById.get(id) : null
    return p ? `${p.first_name} ${p.last_name ?? ''}`.trim() : null
  }

  const prices = new Map<string, { id: string; productId: string | null; productName: string; amountCents: number; currency: string; interval: string | null; intervalCount: number; subscriptions: number; membershipId: string | null }>()
  const rows = []
  for (const sub of subscriptions) {
    const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : (sub.schedule?.id ?? null)
    const schedule = scheduleBySub.get(sub.id)
    if ((schedule && schedule.origin === 'created_here') || (scheduleId && oursBySchedule.has(scheduleId))) continue

    for (const item of sub.items.data) {
      const product = item.price.product as Stripe.Product | Stripe.DeletedProduct | string
      const existing = prices.get(item.price.id)
      if (existing) existing.subscriptions++
      else
        prices.set(item.price.id, {
          id: item.price.id,
          productId: typeof product === 'string' ? product : product.id,
          productName: typeof product === 'string' ? item.price.nickname ?? product : ((product as Stripe.Product).name ?? item.price.nickname ?? ''),
          amountCents: item.price.unit_amount ?? 0,
          currency: item.price.currency,
          interval: item.price.recurring?.interval ?? null,
          intervalCount: item.price.recurring?.interval_count ?? 1,
          subscriptions: 1,
          membershipId: planByPrice.get(item.price.id) ?? null,
        })
    }

    const customer = typeof sub.customer === 'string' || (sub.customer as Stripe.DeletedCustomer).deleted ? null : (sub.customer as Stripe.Customer)
    const matchable = customer ? stripeCustomerAsMatchable(customer) : null
    const known = customer ? patientsByCustomer.get(customer.id) : undefined
    const knownPatientId = known?.length === 1 ? known[0]! : null
    const match = matchable && !schedule && !knownPatientId ? suggestMandatePatient(matchable, patients) : null
    const decision = matchable && !schedule ? stripeAutoPairDecision(match ?? { patientId: null, by: null, ambiguous: false }, matchable, knownPatientId) : null
    const suggestedId = schedule?.patient_id ?? knownPatientId ?? match?.patientId ?? null
    const state = stripeSubscriptionState({ status: sub.status, pauseCollection: sub.pause_collection })
    const mappedPrice = sub.items.data.find((i) => planByPrice.has(i.price.id))?.price ?? null
    const firstPrice = sub.items.data[0]?.price

    rows.push({
      id: sub.id,
      status: sub.status,
      membershipStatus: state?.membership ?? null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      startedAt: new Date(sub.start_date * 1000).toISOString(),
      priceId: (mappedPrice ?? firstPrice)?.id ?? null,
      amountCents: ((mappedPrice ?? firstPrice)?.unit_amount ?? 0) * (sub.items.data.find((i) => i.price.id === (mappedPrice ?? firstPrice)?.id)?.quantity ?? 1),
      mapped: Boolean(mappedPrice),
      customer: customer ? { id: customer.id, name: customer.name ?? '', email: customer.email ?? null, phone: customer.phone ?? null } : null,
      linked: Boolean(schedule),
      patient: suggestedId ? { id: suggestedId, name: nameOf(suggestedId) ?? '' } : null,
      suggestedBy: schedule ? 'linked' : knownPatientId ? 'customer' : (match?.by ?? null),
      suggestedLoosely: Boolean(match && 'loose' in match && match.loose),
      ambiguous: Boolean(match && 'ambiguous' in match && match.ambiguous),
      // What a webhook would do with it unattended -- what Import does by default.
      wouldCreate: decision?.action === 'create',
    })
  }

  return {
    connected: account.stripe_connect_account_id ? 'connect' : 'legacy',
    plans: plans ?? [],
    prices: [...prices.values()].sort((a, b) => b.subscriptions - a.subscriptions),
    subscriptions: rows,
  }
})
