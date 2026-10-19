// The patient sign-in doors (pages/portal/login.vue on web, the app's
// patient side in mobile/pages/login.vue) sign in with the same Supabase
// Auth as the staff door, so on their own they let any account through --
// and in the app, a staff account signed in from the patient door was routed
// straight to its staff tabs (mobile/pages/index.vue), as if the door it
// chose meant nothing. This says whether the account just signed in is
// staff with no patient record of its own, so the patient door can refuse it
// and point at the team door instead.
//
// A dual-identity user (a practitioner who is also a patient of their own
// clinic -- see useIdentity.ts) has a patients row and is let through.
//
// Two-factor is checked first, because while a second factor is owed the
// database hides this person's team_members AND patients rows (see
// 20260923174910_two_factor_login.sql), and "neither" would read as "a new
// patient". Only staff can have a factor or be required to set one up --
// patients have no team_members row and no screen to enrol from -- so a
// gate that is not 'ok' already means a staff account.
//
// No `~/` value imports in here: this file is also compiled into mobile/,
// where `~` means mobile/ (see mobile/nuxt.config.ts).
export function useStaffOnlyCheck() {
  const supabase = useSupabaseClient()
  const { gate } = useTwoFactor()

  return async function isStaffOnly(): Promise<boolean> {
    const { data: session } = await supabase.auth.getSession()
    const userId = session.session?.user.id
    if (!userId) return false

    if ((await gate()) !== 'ok') return true

    const [{ data: patient }, { data: teamMember }] = await Promise.all([
      supabase.from('patients').select('id').eq('user_id', userId).maybeSingle(),
      supabase.from('team_members').select('id').eq('user_id', userId).maybeSingle(),
    ])
    return !!teamMember && !patient
  }
}
