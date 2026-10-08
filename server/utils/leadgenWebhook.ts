import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { loose } from '~/server/utils/publicApiHandlers'
import { ingestMetaLead, type LeadAdPage } from '~/server/utils/metaLeadAds'

// A Facebook Page's leadgen notifications, arriving on the same endpoint as
// WhatsApp and Instagram -- one Meta app, one callback URL, told apart by
// `object`. Shape:
//
//   { object: 'page', entry: [{ id: <page id>, changes: [
//       { field: 'leadgen', value: { leadgen_id, page_id, form_id, ad_id, created_time } } ] }] }
//
// Only ids. The person's details are fetched with the Page's own token, in
// ingestMetaLead, which is also what the catch-up sync calls.

export interface LeadgenEntry {
  id?: string
  changes?: { field?: string; value?: { leadgen_id?: string | number; page_id?: string | number; form_id?: string | number } }[]
}

export async function handleLeadgenEntries(
  supabase: SupabaseClient<Database>,
  entries: LeadgenEntry[],
  auth: WebhookAuth,
  rawBody: Buffer,
  origin: string,
): Promise<{ filed: number; unverified: number }> {
  let filed = 0
  let unverified = 0
  const alreadyReported = new Set<string>()

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue
      // Strings in Meta's documented payload, but its test tool has sent
      // numbers, so both are read the same way. Stored as text everywhere:
      // external_id is what dedupes against the n8n relay's leads.
      const leadgenId = change.value?.leadgen_id != null ? String(change.value.leadgen_id) : ''
      const pageId = String(change.value?.page_id ?? entry.id ?? '')
      if (!leadgenId || !pageId) continue

      // Located from the body, then verified -- the same order the WhatsApp
      // path uses for phone_number_id. page_id is unique across accounts, so
      // this is one row or none.
      const { data } = await loose(supabase)
        .from('lead_ad_pages')
        .select('account_id, page_id, form_submission_is_consent')
        .eq('page_id', pageId)
        .maybeSingle()
      const page = data as LeadAdPage | null
      if (!page) {
        // Meta only delivers for Pages subscribed to this app, so an unknown
        // Page is a subscription that outlived its connection -- a Page
        // disconnected here but not on Meta's side. Worth one line, not one
        // per lead.
        if (!alreadyReported.has(pageId)) {
          alreadyReported.add(pageId)
          console.warn(`[meta-leadgen] no account has Facebook Page ${pageId} connected. Dropping its lead notification(s).`)
        }
        continue
      }

      if (!(await webhookMayActOnAccount(auth, page.account_id, rawBody, supabase))) {
        console.error(`[meta-leadgen] rejected an unverified leadgen notification for account ${page.account_id} (${auth.kind} auth).`)
        unverified++
        continue
      }

      const outcome = await ingestMetaLead(supabase, page, leadgenId, origin)
      if (outcome.kind === 'filed') filed++
      else console.error(`[meta-leadgen] lead ${leadgenId} on Page ${pageId} was ${outcome.kind}: ${outcome.reason}`)
    }
  }

  return { filed, unverified }
}
