import { toE164Loose } from '~/utils/phone'
import { loose } from '~/server/utils/publicApiHandlers'
import { fileLead, humanise, isQuestionKey, accountHasGrowth, type Answer, type FiledLead, type LeadToFile } from '~/server/utils/leadIngest'

// Facebook (and Instagram) lead ads, read straight from Meta.
//
// A submission reaches us as a leadgen webhook carrying only ids -- leadgen_id,
// page_id, form_id, ad_id. The person's answers are never in the webhook; they
// have to be fetched with a Page access token holding leads_retrieval. That is
// what the n8n "Facebook Lead Ads Trigger" node did on our behalf, and the
// mapping below reproduces what its HTTP node then posted to
// /api/public/v1/leads, field for field, so leads look the same on the board
// before and after the cutover:
//
//   first_name / last_name / email / phone_number  <- field_data
//   source            "Meta Ads · <ad set name>"   (the dashboard groups on the
//                                                    part before the dot)
//   external_id       the leadgen id, external_source 'facebook'
//   occurred_at       created_time
//   consent source    "Meta lead form: <form name>"
//   answers           every other field_data entry
//
// One deliberate difference: n8n posted marketing_consent: true for every
// lead, whatever the form said. Here a form's own consent checkbox decides
// when it has one, and the clinic's per-Page setting decides when it has none.

export const LEAD_FIELDS_FULL =
  'id,created_time,field_data,form_id,ad_id,ad_name,adset_name,campaign_name,custom_disclaimer_responses,is_organic,platform'
// What every lead has with leads_retrieval alone. The ad and campaign names
// need ads permissions as well, and a token without them makes Meta refuse the
// WHOLE read rather than leave those fields out -- so a refused full read is
// retried with this, and the lead is filed without its campaign rather than
// not at all.
export const LEAD_FIELDS_CORE = 'id,created_time,field_data,form_id,ad_id,custom_disclaimer_responses,is_organic,platform'

export interface MetaLead {
  id: string
  created_time?: string
  field_data?: { name: string; values?: string[] }[]
  form_id?: string
  ad_id?: string
  ad_name?: string
  adset_name?: string
  campaign_name?: string
  custom_disclaimer_responses?: { checkbox_key?: string; is_checked?: string | boolean }[]
  is_organic?: boolean
  platform?: string
}

function graphBase() {
  return useRuntimeConfig().metaGraphBaseUrl as string
}

/** Meta's own explanation, which is always more useful than the status code. */
export function metaErrorMessage(err: any): string {
  return err?.data?.error?.message ?? err?.message ?? 'unknown error'
}

/** One lead, with as much attribution as the token is allowed to read. */
export async function fetchMetaLead(leadgenId: string, pageToken: string): Promise<MetaLead> {
  try {
    return await $fetch<MetaLead>(`${graphBase()}/${leadgenId}`, { query: { fields: LEAD_FIELDS_FULL, access_token: pageToken } })
  } catch {
    return await $fetch<MetaLead>(`${graphBase()}/${leadgenId}`, { query: { fields: LEAD_FIELDS_CORE, access_token: pageToken } })
  }
}

/**
 * The form's name, for the consent source. Best effort: a lead is worth
 * filing whether or not the form will tell us what it is called.
 */
export async function fetchFormName(formId: string | undefined, pageToken: string): Promise<string | null> {
  if (!formId) return null
  try {
    const form = await $fetch<{ name?: string }>(`${graphBase()}/${formId}`, { query: { fields: 'name', access_token: pageToken } })
    return form.name ?? null
  } catch {
    return null
  }
}

function fieldValue(lead: MetaLead, ...names: string[]): string | undefined {
  for (const field of lead.field_data ?? []) {
    if (names.includes(field.name.toLowerCase())) {
      const value = (field.values ?? []).filter(Boolean).join(', ').trim()
      if (value) return value
    }
  }
  return undefined
}

/**
 * The answer to "did this person agree to marketing", from the form when it
 * asked. Null when it did not ask -- which is not "no", it is "the form has
 * nothing to say", and the caller decides what that means for this Page.
 */
export function consentFromForm(lead: MetaLead): boolean | null {
  const responses = lead.custom_disclaimer_responses ?? []
  if (responses.length === 0) return null
  return responses.some((r) => r.is_checked === true || r.is_checked === '1' || r.is_checked === 'true')
}

export interface PageSettings {
  formSubmissionIsConsent: boolean
  defaultPhoneCountry: string
}

/**
 * The lead as /api/public/v1/leads would have received it from n8n. Returns a
 * reason instead when there is nothing to file -- no name, or no way to reach
 * the person -- since filing those would leave a card on the board nobody can
 * act on.
 */
export function leadFromMeta(lead: MetaLead, formName: string | null, page: PageSettings): LeadToFile | { skip: string } {
  const firstName = fieldValue(lead, 'first_name')
  const lastName = fieldValue(lead, 'last_name')
  const fullName = fieldValue(lead, 'full_name') ?? [firstName, lastName].filter(Boolean).join(' ').trim()
  const email = fieldValue(lead, 'email')?.toLowerCase()
  const rawPhone = fieldValue(lead, 'phone_number', 'phone')
  const phone = rawPhone ? (toE164Loose(rawPhone, page.defaultPhoneCountry) ?? undefined) : undefined

  if (!phone && !email) return { skip: 'the form gave neither a phone number nor an email' }

  const answers: Answer[] = []
  for (const field of lead.field_data ?? []) {
    if (!isQuestionKey(field.name)) continue
    const value = (field.values ?? []).filter((v) => v !== null && v !== undefined && v !== '').join(', ').trim()
    if (!value) continue
    answers.push({ question: humanise(field.name).slice(0, 500), answer: value.slice(0, 2000) })
  }

  const formConsent = consentFromForm(lead)
  const consented = formConsent ?? page.formSubmissionIsConsent

  return {
    fullName: fullName || email || phone || 'Sin nombre',
    phone,
    email,
    // Channel stays 'facebook' even for a lead an Instagram placement
    // produced: that is what every lead so far has been filed as, and the
    // clinic's lead.created rules may filter on it. `platform` is not lost --
    // it is on the attribution row's first_touch.
    channel: 'facebook',
    source: lead.adset_name ? `Meta Ads · ${lead.adset_name}` : lead.is_organic ? 'Meta lead form' : 'Meta Ads',
    externalId: lead.id,
    externalSource: 'facebook',
    occurredAt: lead.created_time ? new Date(lead.created_time).toISOString() : undefined,
    consented,
    consentSource: `Meta lead form: ${formName ?? lead.form_id ?? 'unknown form'}`,
    attribution: {
      campaign: lead.campaign_name?.slice(0, 255),
      audience: lead.adset_name?.slice(0, 255),
      ad: lead.ad_name?.slice(0, 255),
      first_touch: lead.platform ? (lead.platform === 'ig' ? 'Instagram' : lead.platform === 'fb' ? 'Facebook' : lead.platform).slice(0, 255) : undefined,
    },
    answers: answers.slice(0, 50),
  }
}

export interface LeadAdPage {
  account_id: string
  page_id: string
  form_submission_is_consent: boolean
}

export type IngestOutcome =
  | { kind: 'filed'; lead: FiledLead }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string }

/**
 * Fetches one submission from Meta and files it for the clinic that owns the
 * Page. Used by the webhook and by the catch-up sync alike, so a lead filed
 * either way is identical -- and, being keyed on the leadgen id, filed once.
 *
 * Records the outcome on the Page row, because the alternative is a
 * connection that has quietly stopped working and a Settings screen that
 * still says "Connected".
 */
export async function ingestMetaLead(supabase: any, page: LeadAdPage, leadgenId: string, origin: string, prefetched?: MetaLead): Promise<IngestOutcome> {
  const outcome = await ingest()
  const now = new Date().toISOString()
  // A lead that was already filed -- by the webhook, by an earlier sweep, by
  // the n8n relay during the cutover -- says nothing new about the Page.
  const update =
    outcome.kind === 'filed' && !outcome.lead.deduplicated
      ? { last_lead_at: now, last_error: null, last_error_at: null }
      : outcome.kind === 'failed'
        ? { last_error: outcome.reason.slice(0, 500), last_error_at: now }
        : null
  if (update) await loose(supabase).from('lead_ad_pages').update(update as never).eq('page_id', page.page_id)
  return outcome

  async function ingest(): Promise<IngestOutcome> {
    // A lapsed Growth subscription is answered the same way the API answers
    // it -- not captured -- but here nobody would read a 402, so it is said
    // on the Page instead.
    if (!(await accountHasGrowth(supabase, page.account_id))) {
      return { kind: 'failed', reason: 'Growth is not on this subscription, so leads are not being captured.' }
    }

    const { data: tokenRow } = await loose(supabase).from('lead_ad_page_tokens').select('access_token').eq('page_id', page.page_id).maybeSingle()
    const token = (tokenRow as { access_token?: string } | null)?.access_token
    if (!token) return { kind: 'failed', reason: 'No access token is stored for this Page. Connect it again in Settings > Leads.' }

    let metaLead: MetaLead
    try {
      metaLead = prefetched ?? (await fetchMetaLead(leadgenId, token))
    } catch (err) {
      return { kind: 'failed', reason: `Meta would not hand over lead ${leadgenId}: ${metaErrorMessage(err)}` }
    }

    const { data: account } = await loose(supabase).from('accounts').select('default_phone_country').eq('id', page.account_id).maybeSingle()
    const formName = await fetchFormName(metaLead.form_id, token)
    const mapped = leadFromMeta(metaLead, formName, {
      formSubmissionIsConsent: page.form_submission_is_consent,
      defaultPhoneCountry: (account as { default_phone_country?: string } | null)?.default_phone_country ?? 'ES',
    })
    if ('skip' in mapped) return { kind: 'skipped', reason: mapped.skip }

    try {
      return { kind: 'filed', lead: await fileLead(supabase, page.account_id, mapped, origin, 'meta-leadgen') }
    } catch (err) {
      return { kind: 'failed', reason: `Lead ${leadgenId} could not be saved: ${(err as Error).message}` }
    }
  }
}

// ---- Catching up -----------------------------------------------------------
// A webhook is a promise Meta usually keeps. When it does not -- our deploy
// answering 502 for a minute, Meta disabling a subscription after too many
// failures, a token that expired between two leads -- the leads are still
// sitting on the form, and this goes and gets them. Keyed on the leadgen id
// like everything else, so a lead the webhook already filed is a no-op here.
//
// Runs from lead-sequence-cron rather than a cron of its own: that one is
// already scheduled in production, and a new *-cron endpoint does nothing
// until somebody creates its pg_cron job by hand.

/** How often each Page is swept. Leads arrive by webhook; this is the net. */
const SYNC_EVERY_MS = 60 * 60 * 1000
/**
 * How far back each sweep looks past the last one. Generous, because the
 * cost of overlap is a dedupe lookup and the cost of a gap is a lost enquiry.
 */
const SYNC_OVERLAP_MS = 2 * 60 * 60 * 1000
const MAX_PAGES_PER_TICK = 10
const MAX_FORMS_PER_PAGE = 200
const MAX_LEADS_PER_FORM = 200

interface Paged<T> {
  data?: T[]
  paging?: { next?: string }
}

/** Every item of a Graph list, following `next`, up to `cap`. */
async function everyItem<T>(firstUrl: string, query: Record<string, string>, cap: number): Promise<T[]> {
  const items: T[] = []
  let url: string | undefined = firstUrl
  let q: Record<string, string> | undefined = query
  while (url && items.length < cap) {
    const page: Paged<T> = await $fetch<Paged<T>>(url, q ? { query: q } : {})
    items.push(...(page.data ?? []))
    // `next` already carries the token and every parameter.
    url = page.paging?.next
    q = undefined
  }
  return items.slice(0, cap)
}

export interface SyncResult {
  filed: number
  skipped: number
  failed: number
  error?: string
}

export type SyncablePage = LeadAdPage & { connected_at: string; last_synced_at: string | null }

/**
 * Sweeps one Page's forms for leads created since its last sweep, never
 * earlier than the moment it was connected: a clinic connecting its Page must
 * not have last month's enquiries arrive as new ones and start a welcome drip
 * to people who asked weeks ago.
 */
export async function syncLeadAdPage(supabase: any, page: SyncablePage, origin: string): Promise<SyncResult> {
  const result: SyncResult = { filed: 0, skipped: 0, failed: 0 }
  const startedAt = new Date()

  const { data: tokenRow } = await loose(supabase).from('lead_ad_page_tokens').select('access_token').eq('page_id', page.page_id).maybeSingle()
  const token = (tokenRow as { access_token?: string } | null)?.access_token
  if (!token) {
    result.error = 'No access token is stored for this Page. Connect it again in Settings > Leads.'
  } else {
    const connectedAt = new Date(page.connected_at).getTime()
    const lastSweep = page.last_synced_at ? new Date(page.last_synced_at).getTime() - SYNC_OVERLAP_MS : connectedAt
    const since = Math.floor(Math.max(connectedAt, lastSweep) / 1000)
    const filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }])

    try {
      const forms = await everyItem<{ id: string }>(`${graphBase()}/${page.page_id}/leadgen_forms`, { fields: 'id', access_token: token }, MAX_FORMS_PER_PAGE)
      for (const form of forms) {
        const url = `${graphBase()}/${form.id}/leads`
        // The ad and campaign names need more than leads_retrieval, and
        // asking for them refuses the whole list. Same fallback as a single
        // read: file the leads without their campaign.
        const leads = await everyItem<MetaLead>(url, { fields: LEAD_FIELDS_FULL, filtering, access_token: token }, MAX_LEADS_PER_FORM).catch(() =>
          everyItem<MetaLead>(url, { fields: LEAD_FIELDS_CORE, filtering, access_token: token }, MAX_LEADS_PER_FORM),
        )
        for (const lead of leads) {
          const outcome = await ingestMetaLead(supabase, page, lead.id, origin, lead)
          if (outcome.kind === 'filed') {
            if (!outcome.lead.deduplicated) result.filed++
          } else result[outcome.kind]++
        }
      }
    } catch (err) {
      result.error = `Could not read this Page's lead forms: ${metaErrorMessage(err)}`
    }
    // A lead that was read but not saved is still owed, so the window it sits
    // in has to be swept again. ingestMetaLead has already put the reason on
    // the Page.
    if (!result.error && result.failed > 0) result.error = `${result.failed} lead(s) could not be filed and will be retried.`
  }

  // The sweep only counts as done when it read everything. A failed one
  // leaves last_synced_at where it was, so the next one covers this window
  // too instead of skipping past it.
  const update = result.error ? { last_error: result.error.slice(0, 500), last_error_at: startedAt.toISOString() } : { last_synced_at: startedAt.toISOString() }
  await loose(supabase).from('lead_ad_pages').update(update as never).eq('page_id', page.page_id)
  return result
}

/** Every Page due a sweep, least recently swept first, a few per tick. */
export async function syncDueLeadAdPages(supabase: any, origin: string): Promise<SyncResult> {
  const total: SyncResult = { filed: 0, skipped: 0, failed: 0 }
  const dueBefore = new Date(Date.now() - SYNC_EVERY_MS).toISOString()
  const { data: pages } = await loose(supabase)
    .from('lead_ad_pages')
    .select('account_id, page_id, form_submission_is_consent, connected_at, last_synced_at')
    .or(`last_synced_at.is.null,last_synced_at.lt.${dueBefore}`)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PAGES_PER_TICK)

  for (const page of (pages ?? []) as SyncablePage[]) {
    const r = await syncLeadAdPage(supabase, page, origin)
    total.filed += r.filed
    total.skipped += r.skipped
    total.failed += r.failed
    if (r.error) console.error(`[meta-leadgen] sweep of Page ${page.page_id} failed: ${r.error}`)
  }
  return total
}
