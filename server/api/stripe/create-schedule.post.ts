import { serverSupabaseClient } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { stripeClientFor } from '~/server/utils/stripe'

interface Body {
  patientId: string
  packagePurchaseId?: string
  patientMembershipId?: string
  description: string
  totalAmountCents: number // for a fixed-installment package: the FULL price. For a membership: the per-period amount.
  installments?: number // omit for an open-ended membership
  interval: 'day' | 'week' | 'month' | 'year'
  intervalCount: number
  installmentsAlreadyPaid?: number // e.g. patient paid the 1st of 2 installments in cash already
}

function addInterval(date: Date, interval: Body['interval'], count: number): Date {
  const d = new Date(date)
  if (interval === 'day') d.setDate(d.getDate() + count)
  else if (interval === 'week') d.setDate(d.getDate() + count * 7)
  else if (interval === 'month') d.setMonth(d.getMonth() + count)
  else d.setFullYear(d.getFullYear() + count)
  return d
}

export default defineEventHandler(async (event) => {
  const supabase = await serverSupabaseClient<Database>(event)
  const body = await readBody<Body>(event)
  if (!body?.patientId || !body?.description || !body?.totalAmountCents || !body?.interval || !body?.intervalCount) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields' })
  }
  if (!body.packagePurchaseId && !body.patientMembershipId) {
    throw createError({ statusCode: 400, statusMessage: 'Either packagePurchaseId or patientMembershipId is required' })
  }

  const { data: teamMember } = await supabase.from('team_members').select('id, account_id').maybeSingle()
  if (!teamMember) {
    throw createError({ statusCode: 403, statusMessage: 'Not signed in as a team member' })
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('stripe_connect_account_id, stripe_secret_key')
    .eq('id', teamMember.account_id)
    .maybeSingle()
  if (!account) {
    throw createError({ statusCode: 400, statusMessage: 'Stripe is not configured' })
  }

  const { data: customerRow } = await supabase
    .from('patient_stripe_customers')
    .select('stripe_customer_id, default_payment_method_id')
    .eq('patient_id', body.patientId)
    .maybeSingle()
  if (!customerRow?.default_payment_method_id) {
    throw createError({ statusCode: 400, statusMessage: 'This patient has no saved card yet. Add one first.' })
  }

  const skip = body.installmentsAlreadyPaid ?? 0
  const remainingInstallments = body.installments ? body.installments - skip : undefined
  if (remainingInstallments !== undefined && remainingInstallments <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'No installments left to charge via Stripe' })
  }

  const unitAmount = body.installments ? Math.round(body.totalAmountCents / body.installments) : body.totalAmountCents
  const startDate = skip > 0 ? Math.floor(addInterval(new Date(), body.interval, skip * body.intervalCount).getTime() / 1000) : 'now'

  const { stripe, options } = stripeClientFor(account)
  const schedule = await stripe.subscriptionSchedules.create(
    {
      customer: customerRow.stripe_customer_id,
      start_date: startDate,
      end_behavior: body.installments ? 'cancel' : 'release',
      phases: [
        {
          items: [
            {
              price_data: {
                currency: 'eur',
                product_data: { name: body.description },
                unit_amount: unitAmount,
                recurring: { interval: body.interval, interval_count: body.intervalCount },
              },
              quantity: 1,
            },
          ],
          iterations: remainingInstallments,
          default_payment_method: customerRow.default_payment_method_id,
          collection_method: 'charge_automatically',
        },
      ],
    },
    options,
  )

  const { data: inserted, error } = await supabase
    .from('payment_schedules')
    .insert({
      account_id: teamMember.account_id,
      patient_id: body.patientId,
      package_purchase_id: body.packagePurchaseId ?? null,
      patient_membership_id: body.patientMembershipId ?? null,
      stripe_subscription_schedule_id: schedule.id,
      stripe_subscription_id: typeof schedule.subscription === 'string' ? schedule.subscription : null,
      interval: body.interval,
      interval_count: body.intervalCount,
      installments_total: body.installments ?? null,
      installments_paid: skip,
      status: 'active',
    })
    .select('id')
    .single()
  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { success: true, paymentScheduleId: inserted.id, stripeScheduleId: schedule.id }
})
