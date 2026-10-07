import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// Shared vocabulary for the leads endpoints. The stage list lives here rather
// than being re-typed per route, because it is also the board's column order:
// the API returns stages in this sequence and the board renders them in the
// order it is given, so a reorder happens in one place.
export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'booked', 'showed', 'converted', 'lost'] as const
export type LeadStage = (typeof LEAD_STAGES)[number]

export const LEAD_CHANNELS = ['whatsapp', 'sms', 'phone', 'web', 'instagram', 'facebook', 'walk_in'] as const
export type LeadChannel = (typeof LEAD_CHANNELS)[number]

export const STAGE_TITLES: Record<LeadStage, string> = {
  new: 'New Lead',
  contacted: 'Contacted',
  qualified: 'Qualified',
  booked: 'Booked',
  showed: 'Showed',
  converted: 'Converted',
  lost: 'Lost',
}

/**
 * How many cards a stage returns. The board draws a column, not a scrollback:
 * beyond this it shows "+N more" and the count from the aggregate, which is
 * why the count is queried separately rather than taken from rows.length.
 */
export const CARDS_PER_STAGE = 25

export function isLeadStage(value: unknown): value is LeadStage {
  return typeof value === 'string' && (LEAD_STAGES as readonly string[]).includes(value)
}

export function isLeadChannel(value: unknown): value is LeadChannel {
  return typeof value === 'string' && (LEAD_CHANNELS as readonly string[]).includes(value)
}

const REFERENCE_RE = /^LEAD-(\d{4})-(\d+)$/

function formatReference(year: number | string, n: number) {
  return `LEAD-${year}-${String(n).padStart(4, '0')}`
}

/**
 * "LEAD-2026-0918". Sequential per account per year, derived from the leads
 * already there rather than from a sequence table: leads arrive at human pace
 * (hundreds a month, not thousands a second), and a gap here is a cosmetic
 * problem on one screen, not an accounting one. Invoice numbers have their own
 * sequence table precisely because they cannot be.
 *
 * Numbered past the highest reference of the year, the same rule
 * lead_for_attributed_booking() follows in SQL. It used to be a count of this
 * year's leads by created_at, which disagrees with that function as soon as
 * a lead is numbered in one year and dated in another -- a booking made on
 * 31 Dec and attributed on 1 Jan takes 0001 with last year's date, the count
 * then says the next number is 0001 again, and every lead the account
 * receives fails on leads_account_reference_idx until the year ends.
 *
 * The highest is found by sorting the text, which is right while every number
 * has four digits. The count stays as a floor for the year somebody passes
 * 9999, where "10000" sorts below "9999"; insertLead() skips a number that is
 * taken all the same.
 */
export async function nextLeadReference(supabase: SupabaseClient<Database>, accountId: string) {
  const year = new Date().getUTCFullYear()
  const [{ count }, { data: highest }] = await Promise.all([
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gte('created_at', `${year}-01-01T00:00:00Z`),
    supabase
      .from('leads')
      .select('reference')
      .eq('account_id', accountId)
      .like('reference', `LEAD-${year}-%`)
      .order('reference', { ascending: false })
      .limit(1),
  ])

  const top = Number(REFERENCE_RE.exec(highest?.[0]?.reference ?? '')?.[2] ?? 0)
  return formatReference(year, Math.max(count ?? 0, top) + 1)
}

/** How many taken numbers insertLead() steps over before giving up. */
const REFERENCE_ATTEMPTS = 10

function isReferenceClash(error: { code?: string; message?: string } | null) {
  return error?.code === '23505' && (error.message ?? '').includes('leads_account_reference_idx')
}

/**
 * Inserts a lead under the next free reference.
 *
 * Every way a lead is created goes through here, so that a reference already
 * taken -- two leads arriving in the same instant, or one numbered by a path
 * nextLeadReference() cannot see -- moves on to the next number instead of
 * losing the lead to a unique violation. Any other error, including the
 * external-id index a redelivery trips, is returned as it came, so each
 * caller keeps its own handling of it.
 */
export async function insertLead(
  supabase: SupabaseClient<Database>,
  accountId: string,
  row: Omit<Database['public']['Tables']['leads']['Insert'], 'reference' | 'account_id'>,
  columns = 'id',
): Promise<{ data: Record<string, any>; error: null } | { data: null; error: { code?: string; message: string } }> {
  let reference = await nextLeadReference(supabase, accountId)

  for (let attempt = 1; ; attempt++) {
    const { data, error } = await supabase
      .from('leads')
      .insert({ ...row, account_id: accountId, reference })
      .select(columns)
      .single()

    if (!error) return { data: data as Record<string, any>, error: null }
    if (!isReferenceClash(error) || attempt >= REFERENCE_ATTEMPTS) return { data: null, error }
    const [, year, n] = REFERENCE_RE.exec(reference)!
    reference = formatReference(year!, Number(n) + 1)
  }
}

/**
 * Cents to the "1.005 €" the board and drawer render.
 *
 * Was en-IE, which put the symbol first and grouped with commas -- Irish
 * English in a product sold only in Spain, and the one place the Growth
 * screens disagreed with every other euro in the app.
 */
export function formatEuros(cents: number | null) {
  if (cents === null) return null
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

/**
 * What a lead with no figure of its own is worth: the account's default
 * (Settings → Leads). Applied when the value is read rather than copied onto
 * the lead, so changing the default re-values every lead still on it -- a
 * Meta lead never arrives with one -- and none that has its own.
 */
export async function leadDefaultValueCents(supabase: SupabaseClient<Database>, accountId: string): Promise<number | null> {
  const { data } = await supabase.from('accounts').select('lead_default_value_cents').eq('id', accountId).maybeSingle()
  return data?.lead_default_value_cents ?? null
}

/**
 * "12 min in stage" / "2 d in stage". Computed server-side so every client
 * renders the same phrasing, and so the board does not have to hold a clock.
 */
export function timeInStage(since: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min in stage`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h in stage`
  return `${Math.floor(hours / 24)} d in stage`
}

const CHANNEL_TAGS: Record<LeadChannel, string> = {
  whatsapp: 'WA',
  sms: 'SMS',
  phone: 'TEL',
  web: 'WEB',
  instagram: 'IG',
  facebook: 'FB',
  walk_in: 'WALK',
}

export function channelTag(channel: string) {
  return CHANNEL_TAGS[channel as LeadChannel] ?? channel.slice(0, 3).toUpperCase()
}
