import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { setAccountSecret } from '~/server/utils/accountSecrets'
import { exchangeCode, googleError, readState } from '~/server/utils/googleBusiness'

// Where Google sends the browser back after consent. No staff session comes
// with it, so who started the connection is read from the signed state
// (googleBusiness.ts) -- never from anything else in the URL.
//
// Only the token is stored here. Which listing is the clinic's is the next
// step, on Reputation, because a Google user can manage several and picking
// one for them would be a guess.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const back = (outcome: string) => sendRedirect(event, `/growth/reputation?google=${outcome}`)

  // Declined on Google's screen: nothing to do but say so.
  if (query.error) return back('declined')
  const who = typeof query.state === 'string' ? readState(query.state) : null
  if (!who) return back('expired')
  const code = typeof query.code === 'string' ? query.code : ''
  if (!code) return back('failed')

  let refreshToken: string | null
  try {
    ;({ refreshToken } = await exchangeCode(getRequestURL(event).origin, code))
  } catch (err) {
    console.error(`[google-business] could not exchange the code for account ${who.accountId}:`, googleError(err))
    return back('failed')
  }
  // Google sends a refresh token only on a consent screen; without one the
  // connection would stop working within the hour.
  if (!refreshToken) return back('failed')

  const service = serverSupabaseServiceRole<Database>(event)
  await setAccountSecret(service, who.accountId, 'google_business_refresh_token', refreshToken)
  // A new grant may be another Google user, whose listings differ: the
  // listing is chosen again.
  await service.from('accounts').update({ google_business_account: null, google_business_location: null, google_business_location_title: null }).eq('id', who.accountId)
  return back('choose')
})
