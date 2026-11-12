import { randomUUID } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Starts collecting a patient's membership by direct debit, on a mandate
// already matched to them -- typically one they signed through PracticeHub,
// so they sign nothing here.
//
// The one thing this must never do is start a second collection beside one
// still running: on a clinic moving from PracticeHub, the mandate usually
// carries PracticeHub's own subscription until someone cancels it. So any
// other live subscription on the mandate refuses the request by name. If
// GoCardless will not let us see other apps' subscriptions, the caller has
// to say, explicitly, that there is none (`confirmNoOtherSubscription`) --
// the page asks the person, who can check in GoCardless or PracticeHub.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'billing_config')
  const body = await readBody<{ patientMembershipId?: string; mandateId?: string; startDate?: string; confirmNoOtherSubscription?: boolean; attemptId?: string }>(event)
  if (!body?.patientMembershipId) throw createError({ statusCode: 400, statusMessage: 'patientMembershipId is required' })
  if (body.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) throw createError({ statusCode: 400, statusMessage: 'startDate must be YYYY-MM-DD' })

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: membership } = await admin
    .from('patient_memberships')
    .select('id, patient_id, membership_name, price_cents, status, billing_interval, billing_interval_count')
    .eq('id', body.patientMembershipId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'Membership not found' })
  if (membership.status !== 'active') throw createError({ statusCode: 409, statusMessage: 'Only an active membership can be collected' })
  // GoCardless's own floor for a payment.
  if (membership.price_cents < 100) throw createError({ statusCode: 400, statusMessage: 'A direct debit has to be at least 1,00 EUR' })

  const { data: running } = await admin
    .from('payment_schedules')
    .select('id')
    .eq('patient_membership_id', membership.id)
    .in('status', ['active', 'past_due'])
    .limit(1)
  if (running?.length) throw createError({ statusCode: 409, statusMessage: 'This membership is already being collected automatically' })

  const { data: mandates } = await admin
    .from('patient_gocardless_mandates')
    .select('gocardless_mandate_id, status')
    .eq('account_id', teamMember.account_id)
    .eq('patient_id', membership.patient_id)
    .in('status', ['pending_submission', 'submitted', 'active'])
  const usable = (mandates ?? []).filter((m) => !body.mandateId || m.gocardless_mandate_id === body.mandateId)
  if (!usable.length) throw createError({ statusCode: 409, statusMessage: 'This patient has no active direct debit mandate matched in QuiroFlow' })
  if (usable.length > 1) throw createError({ statusCode: 400, statusMessage: 'This patient has more than one mandate: choose which one to collect on' })
  const mandateId = usable[0]!.gocardless_mandate_id

  const request = await gocardlessForAccount(admin, teamMember.account_id)
  if (!request) throw createError({ statusCode: 409, statusMessage: 'GoCardless is not connected' })

  // Read the mandate from GoCardless again rather than trusting the row:
  // ours is only as fresh as the last webhook, and on a clinic leaving
  // PracticeHub the mandate is exactly what someone may have just touched
  // there. Cancelling a membership in PracticeHub was checked (12 Nov 2026)
  // and leaves the mandate alone -- but that rests on two old test cases, and
  // a subscription on a dead mandate would only fail days later, at the bank.
  try {
    const { mandates: live } = await request<{ mandates: GcMandate }>('GET', `/mandates/${encodeURIComponent(mandateId)}`)
    if (live.status !== usable[0]!.status) {
      await admin.from('patient_gocardless_mandates').update({ status: live.status, updated_at: new Date().toISOString() }).eq('account_id', teamMember.account_id).eq('gocardless_mandate_id', mandateId)
    }
    if (!['pending_submission', 'submitted', 'active'].includes(live.status)) {
      throw createError({ statusCode: 409, statusMessage: `This mandate is no longer active in GoCardless (${live.status}). The patient has to sign a new one.` })
    }
  } catch (err: any) {
    if (err?.statusCode === 409) throw err
    if (err instanceof GoCardlessError && err.tokenGone) {
      await forgetGoCardlessConnection(admin, teamMember.account_id)
      throw createError({ statusCode: 409, statusMessage: 'GoCardless was disconnected from its own dashboard. Connect it again.' })
    }
    throw createError({ statusCode: 502, statusMessage: `Could not read the mandate from GoCardless: ${(err as Error).message}` })
  }

  let others: GcSubscription[] | null = null
  try {
    others = await gocardlessListAll<GcSubscription>(request, '/subscriptions', 'subscriptions', { mandate: mandateId, status: 'pending_customer_approval,active,paused' })
  } catch (err) {
    if (err instanceof GoCardlessError && err.tokenGone) {
      await forgetGoCardlessConnection(admin, teamMember.account_id)
      throw createError({ statusCode: 409, statusMessage: 'GoCardless was disconnected from its own dashboard. Connect it again.' })
    }
    console.error('[gocardless subscribe] other subscriptions not readable', (err as Error).message)
  }
  if (others === null && !body.confirmNoOtherSubscription) {
    throw createError({ statusCode: 428, statusMessage: 'GoCardless does not show other apps’ subscriptions on this mandate. Confirm that none is still collecting (for example PracticeHub’s).' })
  }
  const stillCollecting = (others ?? [])[0]
  if (stillCollecting) {
    const next = stillCollecting.upcoming_payments?.[0]?.charge_date
    throw createError({
      statusCode: 409,
      statusMessage: `Another subscription is still collecting on this mandate (${stillCollecting.name ?? stillCollecting.id}${next ? `, next charge ${next}` : ''}). Cancel it — not the mandate — and try again.`,
    })
  }

  let subscription: GcSubscription
  try {
    ;({ subscriptions: subscription } = await request<{ subscriptions: GcSubscription }>('POST', '/subscriptions', {
      idempotencyKey: `qf-sub-${membership.id}-${body.attemptId || randomUUID()}`,
      body: {
        subscriptions: {
          amount: membership.price_cents,
          currency: 'EUR',
          name: membership.membership_name.slice(0, 255),
          ...gocardlessInterval(membership.billing_interval, membership.billing_interval_count),
          ...(body.startDate ? { start_date: body.startDate } : {}),
          metadata: { quiroflow_membership: membership.id },
          links: { mandate: mandateId },
        },
      },
    }))
  } catch (err) {
    throw createError({ statusCode: 502, statusMessage: `GoCardless refused the subscription: ${(err as Error).message}` })
  }

  const { data: inserted, error } = await admin
    .from('payment_schedules')
    .insert({
      account_id: teamMember.account_id,
      patient_id: membership.patient_id,
      patient_membership_id: membership.id,
      provider: 'gocardless',
      gocardless_subscription_id: subscription.id,
      gocardless_mandate_id: mandateId,
      interval: membership.billing_interval ?? 'month',
      interval_count: membership.billing_interval_count ?? 1,
      installments_total: null,
      installments_paid: 0,
      status: 'active',
    })
    .select('id')
    .single()
  if (error || !inserted) {
    // A subscription QuiroFlow does not know about would collect money no
    // report shows. Undo it at GoCardless before reporting the failure.
    await request('POST', `/subscriptions/${subscription.id}/actions/cancel`).catch((e) => console.error('[gocardless subscribe] could not undo', subscription.id, (e as Error).message))
    throw createError({ statusCode: 500, statusMessage: error?.message ?? 'Could not save the schedule' })
  }

  return { ok: true, paymentScheduleId: inserted.id, subscriptionId: subscription.id, firstChargeDate: subscription.upcoming_payments?.[0]?.charge_date ?? null }
})
