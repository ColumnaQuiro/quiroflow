import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { fetchAllRows } from '~/composables/useFetchAllRows'
import { leadPhoneAsContactNumber, phoneMatches, whatsappDigits } from '~/utils/phone'

// Turning a lead into a patient, in the pieces both callers need: the
// "Convert" button (/api/growth/leads/:id/convert) and the AI receptionist
// booking a lead's first visit (receptionistBooking.ts). Moved here from the
// endpoint unchanged, so a record the receptionist creates is made exactly as
// one a person creates -- the duplicate check, the contact number in the
// table recalls and WhatsApp read, the race-safe claim of the lead.
//
// Permission is the caller's: the endpoint checks the member's patients
// scope; the receptionist runs as the service role on the clinic's behalf.

type Supa = SupabaseClient<Database>

interface LeadForConversion {
  clinic_id: string | null
  full_name: string
  phone: string | null
  email: string | null
  source: string | null
}

/**
 * Creates the patient record and their contact number, and returns its id.
 * The caller has already checked for likely duplicates.
 */
export async function createPatientFromLead(
  supabase: Supa,
  accountId: string,
  lead: LeadForConversion,
  opts: { defaultPractitionerId: string | null; defaultCountry: string },
): Promise<string> {
  const [firstName, ...rest] = lead.full_name.trim().split(/\s+/)
  // The id is made here and the row is not read back in the same statement.
  // RLS checks a returned row against the SELECT policy using the snapshot
  // the INSERT started with, and for someone who sees only their own
  // patients that policy asks my_own_patient_ids() -- which cannot yet
  // contain the patient being inserted. So `.insert().select('id')` was a
  // row-level-security error for every 'own'-scope converter. The same fix
  // as AddPatientModal's.
  const newPatientId = randomUUID()
  const { error } = await supabase
    .from('patients')
    .insert({
      id: newPatientId,
      account_id: accountId,
      clinic_id: lead.clinic_id,
      first_name: firstName || lead.full_name,
      last_name: rest.join(' ') || null,
      email: lead.email,
      // Where they came from, kept on the patient so the acquisition story
      // survives on the record itself and not only on the lead.
      referral_source: lead.source,
      default_practitioner_id: opts.defaultPractitionerId,
    } as never)

  if (error) {
    // The RLS policy is the real gate; this is what it looks like when the
    // explicit check has been outgrown by a policy change.
    throw createError({ statusCode: 403, statusMessage: `Could not create the patient record: ${error.message}` })
  }

  const contact = lead.phone ? leadPhoneAsContactNumber(lead.phone, opts.defaultCountry) : null
  if (contact) {
    await supabase.from('patient_contact_numbers').insert({
      account_id: accountId,
      patient_id: newPatientId,
      number: contact.number,
      country_code: contact.countryCode,
      is_whatsapp: true,
    } as never)
  }
  return newPatientId
}

/**
 * Marks the lead converted to `patientId`, only if nothing else already did,
 * and notes it on the lead. `claimed: false` means someone won the race; the
 * patient returned is the one the lead actually points at.
 */
export async function claimConvertedLead(
  supabase: Supa,
  accountId: string,
  leadId: string,
  patientId: string,
  opts: { linked: boolean; source: string | null },
): Promise<{ claimed: boolean; patientId: string }> {
  // Two requests racing -- a double click, or two people on the same lead --
  // both get here, and this is what stops the second from overwriting the
  // first's patient_id and orphaning a record nobody will notice.
  const { data: claimed } = await supabase
    .from('leads')
    .update({ stage: 'converted', patient_id: patientId, converted_at: new Date().toISOString() } as never)
    .eq('id', leadId)
    .eq('account_id', accountId)
    .is('patient_id', null)
    .select('id')
    .maybeSingle()

  if (!claimed) {
    const { data: settled } = await supabase.from('leads').select('patient_id').eq('id', leadId).maybeSingle()
    return { claimed: false, patientId: (settled as { patient_id: string | null } | null)?.patient_id ?? patientId }
  }

  await supabase.from('lead_events').insert({
    account_id: accountId,
    lead_id: leadId,
    kind: 'note',
    title: opts.linked ? 'Linked to an existing patient' : 'Converted to a patient',
    detail: opts.source ? `Attribution kept: ${opts.source}` : null,
  } as never)
  return { claimed: true, patientId }
}


/** Existing patients sharing this lead's phone or email. */
export async function findLikelyExistingPatients(supabase: Supa, accountId: string, phone: string | null, email: string | null) {
  const found = new Map<string, { id: string; name: string; reason: string }>()

  // Compared as E.164, not as text: a patient's number is stored local
  // ("611732681") and the lead's international ("34611732681"), so an exact
  // match on the column never found anyone -- a returning patient converted
  // from an ad sailed past this check by phone. Every number, paged: the
  // first 1000 alone would miss the rest of a clinic's patients.
  const leadDigits = phone ? whatsappDigits(phone) : ''
  if (leadDigits) {
    const numbers = await fetchAllRows((from, to) =>
      supabase
        .from('patient_contact_numbers')
        .select('number, country_code, patients(id, first_name, last_name)')
        .eq('account_id', accountId)
        .order('id')
        .range(from, to),
    )

    for (const row of numbers) {
      const p = row.patients
      if (p && phoneMatches(row.number, row.country_code, leadDigits)) {
        found.set(p.id, { id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(' '), reason: 'Same phone number' })
      }
    }
  }

  if (email) {
    const { data } = await supabase
      .from('patients')
      .select('id, first_name, last_name')
      .eq('account_id', accountId)
      .ilike('email', email)
      .limit(5)

    for (const p of data ?? []) {
      if (!found.has(p.id)) found.set(p.id, { id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(' '), reason: 'Same email address' })
    }
  }

  return [...found.values()]
}
