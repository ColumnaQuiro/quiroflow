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

/**
 * "LEAD-2026-0918". Sequential per account per year, derived by counting this
 * year's leads rather than from a sequence table: leads arrive at human pace
 * (hundreds a month, not thousands a second), and a gap or a reused number
 * here is a cosmetic problem on one screen, not an accounting one. Invoice
 * numbers have their own sequence table precisely because they cannot be.
 */
export async function nextLeadReference(supabase: SupabaseClient<Database>, accountId: string) {
  const year = new Date().getUTCFullYear()
  const { count } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .gte('created_at', `${year}-01-01T00:00:00Z`)

  return `LEAD-${year}-${String((count ?? 0) + 1).padStart(4, '0')}`
}

/** Cents to the "€1,005" the board and drawer render. */
export function formatEuros(cents: number | null) {
  if (cents === null) return null
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
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
