import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { phoneMatches } from '~/utils/phone'

// Whose WhatsApp number is this? The webhook asks it of every inbound
// message, and the Inbox's send asks it of every reply addressed by number
// alone -- the same answer both ways, or a conversation's two halves land on
// different records.

// Returns every patient whose contact number resolves to this phone --
// plural, not singular: staff testing (or a family sharing one phone
// across a few real patients) can leave more than one patient record
// pointing at the same number. Most callers just need any one of
// them (a message can only be attributed to a single patient_id), but the
// confirm/reschedule/cancel handler needs all of them: it resolves which
// specific appointment a reply is about across every patient sharing the
// number (see resolveRepliedAppointment), rather than betting on an
// arbitrary first match that may have nothing scheduled.
export async function findPatientIdsByPhone(supabase: SupabaseClient<Database>, accountId: string, fromNumber: string): Promise<string[]> {
  const PAGE_SIZE = 1000
  const matches: string[] = []
  for (let page = 0; ; page++) {
    const { data } = await supabase
      .from('patient_contact_numbers')
      .select('patient_id, number, country_code')
      .eq('account_id', accountId)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    for (const c of data ?? []) {
      if (phoneMatches(c.number, c.country_code, fromNumber)) matches.push(c.patient_id)
    }
    if (!data || data.length < PAGE_SIZE) return matches
  }
}

/**
 * The lead this number belongs to, when it belongs to no patient.
 *
 * Inbound messages were attributed to a patient or to nobody, which meant a
 * reply from somebody who enquired through a Facebook ad -- a lead, by
 * definition not yet a patient -- attached to nothing. Their thread in the
 * Inbox showed only what the clinic had sent them, with their answers
 * missing, and the lead's own drawer showed no sign they had ever written
 * back.
 *
 * Patients win where a number matches both, deliberately: somebody who has
 * become a patient is a patient, and their clinical thread is the one their
 * messages belong in. This only runs when no patient matched at all.
 *
 * Newest lead wins where one person enquired twice, on the grounds that the
 * reply is far more likely to be about the enquiry they just made.
 */
export async function findLeadIdByPhone(supabase: SupabaseClient<Database>, accountId: string, fromNumber: string): Promise<string | null> {
  const { data } = await supabase
    .from('leads')
    .select('id, phone')
    .eq('account_id', accountId)
    .is('deleted_at', null)
    .not('phone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)

  const incoming = fromNumber.replace(/\D/g, '')
  for (const lead of data ?? []) {
    // The same tolerance patients get: a lead's number may have been typed
    // by hand at the desk, or arrived from Meta with no "+", and both should
    // still match the digits Meta sends on the way back.
    if (lead.phone && phoneMatches(lead.phone, 'ES', incoming)) return lead.id
  }
  return null
}
