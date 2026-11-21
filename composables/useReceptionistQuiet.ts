// Relative, not `~`: the staff app auto-imports this directory too, and
// there `~` is mobile/.
import { RECEPTIONIST_TRIAL_REPLIES, receptionistLimitReached, receptionistOnTrialAllowance } from '../utils/receptionistAllowance'

// Whether the AI receptionist is writing in this clinic at all right now,
// for the Inbox: switched off, stopped by the clinic's monthly reply limit,
// or a trial that has used its allowance (RECEPTIONIST_TRIAL_REPLIES). Either way the only other sign in the Inbox is drafts quietly not
// arriving, which reads as the receptionist being broken.
//
// Read with the member's own client: receptionist_config and the month's
// count are readable by every member of the account, which the settings
// endpoint (communication_config) is not.

export type ReceptionistQuiet = 'off' | 'limit' | 'trial' | null

export function useReceptionistQuiet(enabled: Ref<boolean> | ComputedRef<boolean>, accountId: () => string | null | undefined) {
  const supabase = useSupabaseClient()
  const quiet = ref<ReceptionistQuiet>(null)

  async function load() {
    const id = accountId()
    if (!enabled.value || !id) {
      quiet.value = null
      return
    }
    try {
      const [{ data: config }, { data: count }, { data: subscription }] = await Promise.all([
        supabase.from('receptionist_config').select('enabled, monthly_reply_limit').eq('account_id', id).maybeSingle(),
        supabase.rpc('receptionist_replies_this_month', { p_account_id: id }),
        supabase.from('subscriptions').select('plan_id, growth_addon, receptionist_addon, status, comped, created_at').eq('account_id', id).maybeSingle(),
      ])
      // No row yet: the defaults, which are off.
      if (!config?.enabled) quiet.value = 'off'
      else if (receptionistLimitReached(Number(count ?? 0), config.monthly_reply_limit)) quiet.value = 'limit'
      else if (receptionistOnTrialAllowance(subscription) && (await trialReplies(id, subscription?.created_at)) >= RECEPTIONIST_TRIAL_REPLIES) quiet.value = 'trial'
      else quiet.value = null
    } catch {
      // Unknown is said as nothing rather than as a false alarm.
      quiet.value = null
    }
  }

  // The trial's replies so far, as server/utils/receptionistUsage.ts counts
  // them: since the subscription began.
  async function trialReplies(id: string, since: string | null | undefined): Promise<number> {
    let query = supabase.from('receptionist_replies').select('id', { count: 'exact', head: true }).eq('account_id', id)
    if (since) query = query.gte('created_at', since)
    const { count } = await query
    return count ?? 0
  }

  watch([enabled, accountId], load, { immediate: true })

  return { quiet, reload: load }
}
