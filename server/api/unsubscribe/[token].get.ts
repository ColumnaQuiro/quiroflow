import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { readUnsubscribeToken, unsubscribeClinicName, unsubscribeRecipient } from '~/server/utils/unsubscribe'

// What the unsubscribe page shows before anyone presses anything: whose
// clinic this is, and whether marketing email still reaches them. No login --
// the signed token is the whole credential (server/utils/unsubscribeToken.ts),
// and it only ever names one recipient.
//
// A browser that lands here directly -- a mail client that offers the
// List-Unsubscribe address as a plain link instead of POSTing to it -- is
// sent on to the page, which asks before changing anything.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token') ?? ''
  const accept = getHeader(event, 'accept') ?? ''
  if (accept.includes('text/html') && !accept.includes('application/json')) {
    return sendRedirect(event, `/unsubscribe/${encodeURIComponent(token)}`, 302)
  }

  const who = readUnsubscribeToken(token)
  if (!who) throw createError({ statusCode: 404, statusMessage: 'invalid' })

  const service = serverSupabaseServiceRole<Database>(event)
  const recipient = await unsubscribeRecipient(service, who.kind, who.id)
  if (!recipient) throw createError({ statusCode: 404, statusMessage: 'invalid' })

  return {
    clinicName: await unsubscribeClinicName(service, recipient.accountId),
    unsubscribed: !recipient.subscribed,
  }
})
