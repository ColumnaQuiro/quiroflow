import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

// The rest of the imported appointments an accepted invite promised its new
// member ("gets the imported appointments of <name>").
//
// accept_invite links only the first 2,000 of them. Linking all of a name in
// that one call has no ceiling -- it grows with the name's history -- and if it
// ever outlasted the 8 s statement timeout the whole join would roll back and
// the invitee could not join at all. The rest go here, one bounded batch per
// call. Each call commits on its own, so stopping part-way (the tab closed)
// keeps what was done; what is left still shows under Settings -> Team ->
// imported names for an admin to link.
//
// Safe to run for any new member: with nothing to link the first call returns
// {linked: 0, remaining: 0} and the loop ends.
//
// A plain function rather than a composable: the account middleware runs it
// after an await, where a composable's Nuxt context may already be gone.
// `onStep` reports progress after every batch.
export async function linkInvitedAppointments(
  supabase: SupabaseClient<Database>,
  onStep?: (step: { linked: number; remaining: number }) => void,
): Promise<string | null> {
  let linked = 0
  for (;;) {
    const { data, error } = await supabase.rpc('link_my_invited_appointments', { p_limit: 2000 })
    if (error) return error.message
    const step = (data ?? {}) as { linked?: number; remaining?: number }
    linked += step.linked ?? 0
    const remaining = step.remaining ?? 0
    onStep?.({ linked, remaining })
    // Nothing moved while some remain: another tab holds those rows, or they
    // cannot be linked. Stop rather than ask for them forever.
    if (remaining === 0 || !step.linked) return null
  }
}
