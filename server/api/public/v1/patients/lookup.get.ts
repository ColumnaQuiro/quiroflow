import { requireApiToken, requireScope } from '~/server/utils/apiTokens'
import { phoneMatches } from '~/utils/phone'

// Public, token-authenticated lookup so an external lead-gen automation
// (n8n's Facebook Lead Ads flow, currently checking whether a lead already
// exists in PracticeHub before creating a follow-up task) can ask "has this
// person already become a QuiroFlow patient?" without a Supabase session.
// Matches on email (exact, case-insensitive) and/or phone (digits only, same
// bare-E.164 shape WhatsApp's webhook uses -- see utils/phone.ts's
// phoneMatches, which tolerates a wrong/missing country code on the stored
// contact number). Either is enough; both narrow to an AND-free "any match".
export default defineEventHandler(async (event) => {
  const { supabase, accountId, scopes } = await requireApiToken(event)
  requireScope(scopes, 'patients:read')

  const query = getQuery(event)
  const email = typeof query.email === 'string' ? query.email.trim() : ''
  const phone = typeof query.phone === 'string' ? query.phone.trim() : ''
  if (!email && !phone) {
    throw createError({ statusCode: 400, statusMessage: 'Provide "email" and/or "phone" as query parameters.' })
  }

  const matchedPatientIds = new Set<string>()

  if (email) {
    const { data } = await supabase.from('patients').select('id').eq('account_id', accountId).ilike('email', email)
    for (const row of data ?? []) matchedPatientIds.add(row.id)
  }

  if (phone) {
    const phoneDigits = phone.replace(/\D/g, '')
    const { data: numbers } = await supabase.from('patient_contact_numbers').select('patient_id, number, country_code').eq('account_id', accountId)
    for (const n of numbers ?? []) {
      if (phoneMatches(n.number, n.country_code, phoneDigits)) matchedPatientIds.add(n.patient_id)
    }
  }

  if (matchedPatientIds.size === 0) {
    return { converted: false, patient: null }
  }

  const { data: patient } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email')
    .in('id', [...matchedPatientIds])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return {
    converted: true,
    patient: patient ? { id: patient.id, firstName: patient.first_name, lastName: patient.last_name, email: patient.email } : null,
  }
})
