import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { readUnsubscribeToken, unsubscribe, unsubscribeClinicName, unsubscribeRecipient } from '~/server/utils/unsubscribe'

// Unsubscribes the recipient a signed token names from the clinic's marketing
// email. Two callers: the page's "Darme de baja" button, and a mail client's
// one-click unsubscribe (RFC 8058), which POSTs `List-Unsubscribe=One-Click`
// to the address in the List-Unsubscribe header with no cookies and no
// login. The body is not read -- the token is the whole request -- and a
// second call is a no-op that still answers 200, since a client retrying a
// one-click request must not see it fail.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token') ?? ''
  const who = readUnsubscribeToken(token)
  if (!who) throw createError({ statusCode: 404, statusMessage: 'invalid' })

  const service = serverSupabaseServiceRole<Database>(event)
  const recipient = await unsubscribeRecipient(service, who.kind, who.id)
  if (!recipient) throw createError({ statusCode: 404, statusMessage: 'invalid' })

  const { changed } = await unsubscribe(service, recipient)
  return {
    clinicName: await unsubscribeClinicName(service, recipient.accountId),
    unsubscribed: true,
    alreadyUnsubscribed: !changed,
  }
})
