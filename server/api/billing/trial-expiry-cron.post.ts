import { serverSupabaseServiceRole } from '#supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { TRIAL_GRACE_DAYS } from '~/utils/billing'
import { FOUNDER_NOTICE, dueTrialNotice, founderAlertDue, founderTrialAlertEmail, trialNoticeEmail, type TrialNotice } from '~/server/utils/trialNotices'
import { sendResendEmail } from '~/server/utils/resend'

// The end of a free trial that never got a card, run once a day.
//
// This is the only thing that moves such an account along: with no Stripe
// subscription there is no Stripe object to ever fire a webhook, so the row
// would otherwise sit at 'trialing' forever. Accounts that DO have a Stripe
// subscription are left alone entirely -- Stripe's own status (and the
// platform-billing webhook that mirrors it) governs those.
//
// It no longer locks on the day the trial ends. The trial runs on for a grace
// week (TRIAL_GRACE_DAYS), and only then is the row set to 'locked' -- which
// now means READ-ONLY, not locked out
// (20261120184541_trial_grace_then_read_only.sql). Along the way it emails
// the owner (server/utils/trialNotices.ts): a week, three days and a day
// before, the day it ends, during the grace week, the day before read-only
// and on the day itself; and it tells us three days before, so somebody can
// call while it still helps.
//
// Same shared-secret-header pattern as birthday-cron.post.ts -- there's no
// session on a pg_cron-fired call, so a pg_cron job (registered directly
// against the production project, not in a migration -- see
// 0081_enable_pg_cron.sql's comment on why) posts here once a day with the
// same X-Cron-Secret already used by every other scheduled job.
type Service = SupabaseClient<Database>

interface Owner {
  name: string | null
  email: string | null
  language: 'es' | 'en'
  lastSignInAt: string | null
}

async function ownerOf(supabase: Service, accountId: string): Promise<Owner | null> {
  const { data: member } = await supabase
    .from('team_members')
    .select('full_name, user_id, language_preference')
    .eq('account_id', accountId)
    .eq('is_owner', true)
    .is('deleted_at', null)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (!member?.user_id) return null
  const { data: auth } = await supabase.auth.admin.getUserById(member.user_id)
  return {
    name: member.full_name ?? null,
    email: auth?.user?.email ?? null,
    language: member.language_preference === 'en' ? 'en' : 'es',
    lastSignInAt: auth?.user?.last_sign_in_at ?? null,
  }
}

async function markSent(supabase: Service, accountId: string, sent: string[], add: string) {
  const next = [...new Set([...sent, add])]
  await supabase.from('subscriptions').update({ trial_notices_sent: next }).eq('account_id', accountId)
  return next
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const now = new Date()
  // No email provider (a local or CI run): the notices are still decided and
  // recorded, so what the cron would have sent is visible and testable.
  const canEmail = !!runtimeConfig.resendApiKey
  const founderTo = runtimeConfig.signupNotifyEmail as string

  async function deliver(to: string | null, email: { subject: string; html: string }): Promise<boolean> {
    if (!canEmail) return true
    if (!to) return false
    try {
      await sendResendEmail({ to, ...email })
      return true
    } catch (err) {
      console.error('[trial-expiry-cron] email not sent', email.subject, err)
      return false
    }
  }

  // 1. Past the grace week: read-only.
  const graceCutoff = new Date(now.getTime() - TRIAL_GRACE_DAYS * 86_400_000).toISOString()
  const { data: locked, error } = await supabase
    .from('subscriptions')
    .update({ status: 'locked', updated_at: now.toISOString() })
    .eq('status', 'trialing')
    .eq('comped', false)
    .is('stripe_subscription_id', null)
    .lt('trial_ends_at', graceCutoff)
    .select('account_id, trial_ends_at, trial_notices_sent')
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  const notices: Array<{ accountId: string; notice: TrialNotice | typeof FOUNDER_NOTICE; delivered: boolean }> = []
  const accountNames = new Map<string, string>()
  async function clinicName(accountId: string) {
    if (!accountNames.has(accountId)) {
      const { data } = await supabase.from('accounts').select('name').eq('id', accountId).maybeSingle()
      accountNames.set(accountId, data?.name ?? 'tu clínica')
    }
    return accountNames.get(accountId)!
  }

  for (const row of locked ?? []) {
    if (!row.trial_ends_at || (row.trial_notices_sent ?? []).includes('read_only')) continue
    const owner = await ownerOf(supabase, row.account_id)
    const email = trialNoticeEmail('read_only', { language: owner?.language ?? 'es', ownerName: owner?.name ?? null, clinicName: await clinicName(row.account_id), trialEndsAt: row.trial_ends_at })
    const delivered = await deliver(owner?.email ?? null, email)
    if (delivered) await markSent(supabase, row.account_id, row.trial_notices_sent ?? [], 'read_only')
    notices.push({ accountId: row.account_id, notice: 'read_only', delivered })
  }

  // 2. Trials ending within a week, or inside their grace week: the notice due today.
  const windowStart = graceCutoff
  const windowEnd = new Date(now.getTime() + 8 * 86_400_000).toISOString()
  const { data: open, error: openError } = await supabase
    .from('subscriptions')
    .select('account_id, trial_ends_at, trial_notices_sent, accounts(created_at, owner_phone)')
    .eq('status', 'trialing')
    .eq('comped', false)
    .is('stripe_subscription_id', null)
    .gte('trial_ends_at', windowStart)
    .lte('trial_ends_at', windowEnd)
  if (openError) throw createError({ statusCode: 500, statusMessage: openError.message })

  for (const row of open ?? []) {
    if (!row.trial_ends_at) continue
    let sent = row.trial_notices_sent ?? []
    const due = dueTrialNotice(row.trial_ends_at, sent, now)
    const founder = founderAlertDue(row.trial_ends_at, sent, now)
    if (!due && !founder) continue

    const owner = await ownerOf(supabase, row.account_id)
    const name = await clinicName(row.account_id)

    if (due) {
      const delivered = await deliver(owner?.email ?? null, trialNoticeEmail(due, { language: owner?.language ?? 'es', ownerName: owner?.name ?? null, clinicName: name, trialEndsAt: row.trial_ends_at }))
      if (delivered) sent = await markSent(supabase, row.account_id, sent, due)
      notices.push({ accountId: row.account_id, notice: due, delivered })
    }

    if (founder) {
      const [{ count: patients }, { count: appointments }] = await Promise.all([
        supabase.from('patients').select('id', { count: 'exact', head: true }).eq('account_id', row.account_id),
        supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('account_id', row.account_id),
      ])
      const account = row.accounts as { created_at: string | null; owner_phone: string | null } | null
      const delivered = founderTo
        ? await deliver(founderTo, founderTrialAlertEmail({
            clinicName: name,
            ownerName: owner?.name ?? null,
            ownerEmail: owner?.email ?? null,
            ownerPhone: account?.owner_phone ?? null,
            trialEndsAt: row.trial_ends_at,
            signedUpAt: account?.created_at ?? null,
            patients: patients ?? 0,
            appointments: appointments ?? 0,
            lastSignInAt: owner?.lastSignInAt ?? null,
          }))
        : true
      if (delivered) sent = await markSent(supabase, row.account_id, sent, FOUNDER_NOTICE)
      notices.push({ accountId: row.account_id, notice: FOUNDER_NOTICE, delivered })
    }
  }

  return { locked: locked?.length ?? 0, notices }
})
