// Relative, not `~`: the staff app auto-imports this directory too, and
// there `~` is mobile/.
import { receptionistLimitReached } from '../utils/receptionistAllowance'

// Whether the AI receptionist is writing in this clinic at all right now,
// for the Inbox: switched off, or stopped by the clinic's monthly reply
// limit. Either way the only other sign in the Inbox is drafts quietly not
// arriving, which reads as the receptionist being broken.
//
// Read with the member's own client: receptionist_config and the month's
// count are readable by every member of the account, which the settings
// endpoint (communication_config) is not.

export type ReceptionistQuiet = 'off' | 'limit' | null

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
      const [{ data: config }, { data: count }] = await Promise.all([
        supabase.from('receptionist_config').select('enabled, monthly_reply_limit').eq('account_id', id).maybeSingle(),
        supabase.rpc('receptionist_replies_this_month', { p_account_id: id }),
      ])
      // No row yet: the defaults, which are off.
      if (!config?.enabled) quiet.value = 'off'
      else if (receptionistLimitReached(Number(count ?? 0), config.monthly_reply_limit)) quiet.value = 'limit'
      else quiet.value = null
    } catch {
      // Unknown is said as nothing rather than as a false alarm.
      quiet.value = null
    }
  }

  watch([enabled, accountId], load, { immediate: true })

  return { quiet, reload: load }
}
