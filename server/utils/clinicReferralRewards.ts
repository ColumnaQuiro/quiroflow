import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { clinicReferralRewardCents, referralRewardAction, sharesAnOwner } from '~/utils/clinicReferral'

// Applies the clinic-to-clinic referral offer ("¡Recomienda a tus amigos!",
// utils/clinicReferral.ts) to platform billing. Each side's discount is a
// one-use Stripe coupon worth 10% of its plan's monthly price, attached to one
// invoice and recorded in clinic_referral_rewards so it is never given twice:
//
//   referred clinic -- its first paid invoice. On Checkout without a trial
//     (charged at once) the coupon rides on the Session (checkoutReferralCoupon);
//     after a trial it is added to the draft Stripe makes when the trial ends.
//   referrer -- once the referred clinic has paid something
//     (onReferralInvoicePaid), its own next invoice, while that is a draft.
//
// Coupons, not customer balance: a coupon lowers the taxable base and shows on
// the factura as a discount, where a balance credit would leave the full IVA
// charged on a price the clinic did not pay.
//
// Every function throws on a database or Stripe error, so the webhook answers
// 500 and Stripe retries the event.

type Db = SupabaseClient<Database>
type Reward = Database['public']['Tables']['clinic_referral_rewards']['Row']

const COUPON_NAME = 'Recomendación: 10% de un mes'

/** The account an invoice bills, from the subscription metadata Checkout set (subscribe.post.ts). */
export function invoiceAccountId(invoice: Stripe.Invoice): string | null {
  return invoice.parent?.subscription_details?.metadata?.account_id ?? null
}

/** The clinic that referred `accountId`, when that referral earns a reward. */
async function rewardingReferrer(db: Db, accountId: string): Promise<string | null> {
  const { data: account, error } = await db.from('accounts').select('referred_by_account_id').eq('id', accountId).maybeSingle()
  if (error) throw error
  const referrer = account?.referred_by_account_id
  if (!referrer || referrer === accountId) return null

  const { data: owners, error: ownersError } = await db
    .from('team_members')
    .select('account_id, user_id')
    .in('account_id', [accountId, referrer])
    .eq('is_owner', true)
  if (ownersError) throw ownersError
  const of = (id: string) => (owners ?? []).filter((o) => o.account_id === id).map((o) => o.user_id)
  if (sharesAnOwner(of(accountId), of(referrer))) return null
  return referrer
}

/** Makes the referred clinic's own reward row, if it is owed one and has none yet. */
async function ensureReferredReward(db: Db, accountId: string): Promise<void> {
  if (!(await rewardingReferrer(db, accountId))) return
  const { error } = await db
    .from('clinic_referral_rewards')
    .upsert({ account_id: accountId, referred_account_id: accountId, role: 'referred' }, { onConflict: 'referred_account_id,role', ignoreDuplicates: true })
  if (error) throw error
}

async function pendingRewards(db: Db, accountId: string): Promise<Reward[]> {
  const { data, error } = await db.from('clinic_referral_rewards').select('*').eq('account_id', accountId).eq('status', 'pending').order('created_at')
  if (error) throw error
  return data ?? []
}

async function monthlyPlanCents(db: Db, accountId: string): Promise<number | null> {
  const { data, error } = await db.from('subscriptions').select('plans(monthly_price_cents)').eq('account_id', accountId).maybeSingle()
  if (error) throw error
  const plan = data?.plans as { monthly_price_cents: number } | { monthly_price_cents: number }[] | null | undefined
  return (Array.isArray(plan) ? plan[0] : plan)?.monthly_price_cents ?? null
}

/**
 * The reward's coupon, made the first time it is needed and kept on the row.
 * Reused rather than remade: a Checkout that was abandoned leaves it unspent,
 * and the next attempt carries the same one. The idempotency key makes a
 * retried webhook get the same coupon back instead of minting a second.
 */
async function rewardCoupon(stripe: Stripe, db: Db, reward: Reward, currency: string): Promise<string | null> {
  if (reward.stripe_coupon_id) return reward.stripe_coupon_id
  const cents = clinicReferralRewardCents(await monthlyPlanCents(db, reward.account_id))
  if (!cents) return null
  const coupon = await stripe.coupons.create(
    {
      amount_off: cents,
      currency,
      duration: 'once',
      max_redemptions: 1,
      name: COUPON_NAME,
      metadata: { clinic_referral_reward_id: reward.id, role: reward.role, referred_account_id: reward.referred_account_id },
    },
    { idempotencyKey: `clinic-referral-reward-${reward.id}` },
  )
  const { error } = await db.from('clinic_referral_rewards').update({ stripe_coupon_id: coupon.id, amount_cents: cents }).eq('id', reward.id)
  if (error) throw error
  reward.stripe_coupon_id = coupon.id
  reward.amount_cents = cents
  return coupon.id
}

/**
 * For /api/billing/subscribe: the coupon to put on a Checkout Session that will
 * charge at once (no trial left), so the referred clinic's first invoice -- one
 * Stripe finalises immediately, leaving no draft to add it to -- carries it.
 * Not marked applied here: onReferralInvoiceCreated records it when the
 * invoice actually exists, and an abandoned Checkout leaves it pending.
 */
export async function checkoutReferralCoupon(stripe: Stripe, db: Db, accountId: string): Promise<string | null> {
  await ensureReferredReward(db, accountId)
  const reward = (await pendingRewards(db, accountId)).find((r) => r.role === 'referred')
  return reward ? rewardCoupon(stripe, db, reward, 'eur') : null
}

/**
 * invoice.created: puts every pending reward for the invoice's clinic on it,
 * or records the one Checkout already put there. A 0 EUR trial invoice is left
 * alone, so the coupon waits for the first one with something to pay.
 */
export async function onReferralInvoiceCreated(stripe: Stripe, db: Db, created: Stripe.Invoice): Promise<{ applied: number }> {
  const accountId = invoiceAccountId(created)
  if (!accountId || !created.id || created.total <= 0) return { applied: 0 }

  await ensureReferredReward(db, accountId)
  const rewards = await pendingRewards(db, accountId)
  if (!rewards.length) return { applied: 0 }

  // The event's copy has discounts as bare ids; the coupon behind each is what
  // says whether Checkout already applied ours.
  const invoice = await stripe.invoices.retrieve(created.id, { expand: ['discounts'] })
  let applied = 0
  for (const reward of rewards) {
    const action = referralRewardAction(reward, invoice)
    if (action === 'skip') continue
    if (action === 'attach' && !(await rewardCoupon(stripe, db, reward, invoice.currency))) continue

    // Claimed before Stripe is called, conditionally on still being pending,
    // so two deliveries of the same event cannot both attach it.
    const { data: claimed, error } = await db
      .from('clinic_referral_rewards')
      .update({ status: 'applied', stripe_invoice_id: created.id, applied_at: new Date().toISOString() })
      .eq('id', reward.id)
      .eq('status', 'pending')
      .select('id')
    if (error) throw error
    if (!claimed?.length) continue

    if (action === 'attach') {
      try {
        // Re-listing the discounts already there keeps them: passing
        // `discounts` replaces the invoice's set.
        const keep = invoice.discounts.map((d) => ({ discount: typeof d === 'string' ? d : d.id }))
        const updated = await stripe.invoices.update(created.id, { discounts: [...keep, { coupon: reward.stripe_coupon_id! }], expand: ['discounts'] })
        invoice.discounts = updated.discounts
      } catch (err) {
        await db.from('clinic_referral_rewards').update({ status: 'pending', stripe_invoice_id: null, applied_at: null }).eq('id', reward.id)
        throw err
      }
    }
    applied++
  }
  return { applied }
}

/**
 * invoice.paid: the referred clinic has paid real money, so the clinic that
 * referred it is owed its discount. Recorded pending; its own next invoice
 * picks it up in onReferralInvoiceCreated.
 */
export async function onReferralInvoicePaid(db: Db, invoice: Stripe.Invoice): Promise<{ granted: boolean }> {
  const accountId = invoiceAccountId(invoice)
  if (!accountId || invoice.amount_paid <= 0) return { granted: false }
  const referrer = await rewardingReferrer(db, accountId)
  if (!referrer) return { granted: false }
  const { data, error } = await db
    .from('clinic_referral_rewards')
    .upsert({ account_id: referrer, referred_account_id: accountId, role: 'referrer' }, { onConflict: 'referred_account_id,role', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  return { granted: !!data?.length }
}
