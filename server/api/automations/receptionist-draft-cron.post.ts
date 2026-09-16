import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { draftLeadReply } from '~/server/utils/receptionistDraft'
import { hasGrowth } from '~/server/utils/requireGrowth'

// Drafts a reply for every lead waiting on one, so the draft is there before
// anybody goes looking.
//
// Until now drafting only happened when somebody opened a thread and pressed
// a button, which means the receptionist only ever helped people who had
// already decided to deal with that lead. A lead writing at 21:40 had a draft
// available, not a draft waiting -- and those are different products.
//
// Deliberately still only a draft. Nothing here sends; approving stays a
// person reading the words and pressing send, which is why this needs no kill
// switch beyond the one it already honours and no answer to "what if it is
// wrong".
//
// Same 15-minute tick as the other automation crons. A tick is fine because
// nothing is waiting on this: the person who reads the draft is not sitting
// there watching for it, and a reply drafted 9 minutes after the question is
// indistinguishable from one drafted instantly by the time anyone looks.
const MAX_PER_TICK = 25
const CONCURRENCY = 3

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const secret = getHeader(event, 'x-cron-secret')
  if (!runtimeConfig.cronSecret || secret !== runtimeConfig.cronSecret) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const supabase = serverSupabaseServiceRole<Database>(event)

  // Only accounts that switched the receptionist on. Reading this first, and
  // once, rather than per lead: it is the cheapest way to narrow the work and
  // it is the answer least likely to change within a tick.
  const { data: enabledConfigs } = await supabase
    .from('receptionist_config')
    .select('account_id')
    .eq('enabled', true)

  const accountIds = (enabledConfigs ?? []).map((c) => c.account_id)
  if (accountIds.length === 0) return { drafted: 0, considered: 0, consideredLeadIds: [] as string[] }

  // Growth is a paid add-on, and the cron runs as the service role -- outside
  // requireGrowth, which is what enforces that everywhere else. Checked here
  // rather than assumed: an account that stops paying must stop being worked
  // on, and a background job is exactly where that would go unnoticed.
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('account_id, growth_addon, status, comped')
    .in('account_id', accountIds)

  const entitled = new Set(
    (subscriptions ?? []).filter((s) => hasGrowth(s)).map((s) => s.account_id),
  )
  if (entitled.size === 0) return { drafted: 0, considered: 0, consideredLeadIds: [] as string[] }

  // Leads the receptionist is handling, for those accounts. The "has anything
  // been said since we drafted" test needs the messages, so it happens below
  // rather than in SQL -- but the set being scanned is already small: leads
  // being handled by the AI, for accounts paying for it.
  const { data: candidates } = await supabase
    .from('leads')
    .select('id, account_id, ai_drafted_through_at')
    .in('account_id', Array.from(entitled))
    .eq('ai_state', 'handling')
    .is('deleted_at', null)
    // A draft already sitting there is somebody's to deal with, not ours to
    // replace. Overwriting it would discard an edit in progress.
    .is('ai_draft_body', null)
    .limit(200)

  const due: { id: string; accountId: string }[] = []

  for (const lead of candidates ?? []) {
    const { data: lastInbound } = await supabase
      .from('whatsapp_messages')
      .select('created_at')
      .eq('lead_id', lead.id)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!lastInbound) continue

    // Nothing new since the last draft. This is what stops a discarded draft
    // being rewritten on the next tick, over and over, with the clinic unable
    // to get rid of it.
    if (lead.ai_drafted_through_at && lastInbound.created_at <= lead.ai_drafted_through_at) continue

    // WhatsApp refuses a free-form reply more than 24h after the last inbound
    // message, so a draft nobody could send is a draft not worth paying a
    // model to write.
    if (Date.now() - new Date(lastInbound.created_at).getTime() >= 24 * 3600 * 1000) continue

    due.push({ id: lead.id, accountId: lead.account_id })
    if (due.length >= MAX_PER_TICK) break
  }

  let drafted = 0

  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const batch = due.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (lead) => {
        try {
          const outcome = await draftLeadReply(supabase, lead.accountId, lead.id)
          return outcome.status === 'drafted'
        } catch (err) {
          // One lead's model call failing must not cost the rest of the tick.
          // Whatever went wrong is still true next tick, and the lead is
          // still due then.
          console.error(`[receptionist-draft-cron] lead ${lead.id} failed:`, (err as Error)?.message ?? err)
          return false
        }
      }),
    )
    drafted += results.filter(Boolean).length
  }

  // The ids, not just the count: a tick that drafted nothing and a tick that
  // drafted for somebody unexpected look identical in a number, and this is a
  // background job whose choices nobody watches. Bounded by MAX_PER_TICK.
  return { drafted, considered: due.length, consideredLeadIds: due.map((l) => l.id) }
})
