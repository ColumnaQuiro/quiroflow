import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// One endpoint for every clinic connected to QuiroFlow's GoCardless partner
// app: register it once as the app's webhook URL. GoCardless batches up to
// 250 events per delivery, each naming its clinic in links.organisation.
//
// Answering anything but 2xx makes GoCardless deliver the whole batch again
// (up to 8 times), which is safe because every handler is idempotent -- so a
// failure on one event fails the request rather than being swallowed and
// losing that event for good. The reconcile cron is the second net.
export default defineEventHandler(async (event) => {
  const secret = useRuntimeConfig().gocardlessWebhookSecret as string
  if (!secret) throw createError({ statusCode: 500, statusMessage: 'GoCardless webhooks are not configured on this deployment' })

  const rawBody = await readRawBody(event)
  if (!rawBody || !gocardlessSignatureValid(rawBody, getHeader(event, 'webhook-signature'), secret)) {
    // 498 is what GoCardless's own docs answer an invalid signature with.
    throw createError({ statusCode: 498, statusMessage: 'Invalid signature' })
  }

  const events = (JSON.parse(rawBody)?.events ?? []) as GcEvent[]
  const supabase = serverSupabaseServiceRole<Database>(event)
  const origin = getRequestURL(event).origin

  const organisations = [...new Set(events.map((e) => e.links?.organisation).filter(Boolean))] as string[]
  const { data: accounts } = organisations.length
    ? await supabase.from('accounts').select('id, gocardless_organisation_id').in('gocardless_organisation_id', organisations)
    : { data: [] }
  const accountByOrganisation = new Map((accounts ?? []).map((a) => [a.gocardless_organisation_id!, a.id]))

  let failed = 0
  for (const gcEvent of events) {
    const accountId = accountByOrganisation.get(gcEvent.links?.organisation ?? '')
    // An organisation no clinic has connected (any more): nothing of ours.
    if (!accountId) continue
    try {
      await handleGoCardlessEvent(supabase, accountId, gcEvent, origin)
    } catch (err) {
      failed++
      console.error('[gocardless webhook] event failed', gcEvent.id, gcEvent.resource_type, gcEvent.action, (err as Error).message)
    }
  }
  if (failed) throw createError({ statusCode: 500, statusMessage: `${failed} event(s) could not be processed` })
  return { received: events.length }
})
