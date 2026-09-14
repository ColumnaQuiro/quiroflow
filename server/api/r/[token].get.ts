import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// The review link a patient clicks.
//
// No session at all -- the patient is not signed in to anything, same as the
// photo-upload and waitlist claim links. Recording the open is what turns the
// middle step of the review funnel from a guess into a fact, and it is the
// only step of the three we can observe ourselves.
//
// It always redirects, whether or not the token is real. A 404 here would let
// anyone probe for valid tokens, and would strand a patient who clicked a
// link from a message we sent.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  const supabase = serverSupabaseServiceRole<Database>(event)

  let destination = 'https://www.google.com/maps'

  if (token) {
    const { data: request } = await supabase
      .from('review_requests')
      .select('account_id')
      .eq('token', token)
      .maybeSingle()

    if (request) {
      await supabase.rpc('record_review_request_opened', { p_token: token })

      const { data: account } = await supabase
        .from('accounts')
        .select('google_review_url')
        .eq('id', request.account_id)
        .maybeSingle()

      if (account?.google_review_url) destination = account.google_review_url
    }
  }

  return sendRedirect(event, destination, 302)
})
