import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { requireGrowth } from '~/server/utils/requireGrowth'
import { automationEvent } from '~/server/utils/automationEngine'
import { claimConvertedLead, createPatientFromLead, findLikelyExistingPatients } from '~/server/utils/leadConversion'

interface Body {
  /** Attach the lead to this existing patient instead of creating one. */
  linkPatientId?: unknown
  /** Create a new record even though a likely duplicate was found. */
  createAnyway?: unknown
}

/**
 * Turns a lead into a patient. The terminal action of the whole Growth tier,
 * and the only one that writes a clinical record.
 *
 * Three things make this more than an insert:
 *
 * 1. It must be idempotent. A double-clicked button, or a retried request,
 *    must not leave a clinic with two records for one person -- the damage
 *    there is a split clinical history and a split balance, which someone has
 *    to merge by hand.
 * 2. The person may already be a patient. A returning patient who enquires
 *    through an ad is an ordinary case, not an edge one, and converting them
 *    blindly is exactly how duplicates get made. So a likely match stops the
 *    conversion and asks, rather than guessing either way.
 * 3. Phone numbers live in patient_contact_numbers, not on `patients` -- a
 *    trigger there is what flips patients.has_phone, which is what the
 *    recalls and WhatsApp screens filter on. Setting patients.phone alone
 *    would produce a patient the clinic cannot message. And they live there
 *    in a different shape: local number plus country, where the lead's is
 *    international (leadPhoneAsContactNumber).
 *
 * Permission: Growth access gets you here, but the patients RLS policy is
 * what actually allows the insert -- it requires patients_scope != 'none'.
 * A marketing-only role therefore cannot create clinical records through
 * this route, which is checked below so the caller gets a sentence rather
 * than an RLS violation.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing lead id' })

  const { supabase, teamMember } = await requireGrowth(event)
  // ?? {} as well as the catch: readBody RESOLVES to undefined for a request
  // with no body at all, so the catch never fires and the first property
  // access throws. A bare POST with no options is the commonest call this
  // endpoint gets -- "convert this lead, no special instructions" -- and it
  // was the one shape that 500'd.
  const body = (await readBody<Body>(event).catch(() => null)) ?? ({} as Body)

  const { data: lead } = await supabase
    .from('leads')
    .select('id, account_id, clinic_id, full_name, phone, email, source, stage, patient_id')
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!lead) throw createError({ statusCode: 404, statusMessage: 'Lead not found' })

  // Already converted. Returning the existing patient rather than erroring:
  // the caller wanted this lead to be a patient, and it is.
  if (lead.patient_id) {
    return { patientId: lead.patient_id, created: false, alreadyConverted: true }
  }

  const { data: scope } = await supabase.rpc('permission_scope', {
    target_account_id: teamMember.account_id,
    perm_key: 'patients_scope',
  })
  if (scope === 'none') {
    throw createError({ statusCode: 403, statusMessage: 'Converting a lead creates a patient record, which your role cannot do.' })
  }

  const linkPatientId = typeof body.linkPatientId === 'string' ? body.linkPatientId : null
  let patientId = linkPatientId

  const { data: account } = await supabase.from('accounts').select('default_phone_country').eq('id', teamMember.account_id).maybeSingle()
  const defaultCountry = account?.default_phone_country ?? 'ES'

  if (!patientId) {
    // Look for someone who is plainly already a patient. Phone and email
    // only -- matching on name alone would flag every second Garcia in
    // Barcelona and train people to click through the warning.
    const candidates = await findLikelyExistingPatients(supabase, teamMember.account_id, lead.phone, lead.email)

    if (candidates.length > 0 && body.createAnyway !== true) {
      // 409, with what was found. The decision belongs to whoever is looking
      // at the clinic's records, not to this endpoint.
      throw createError({
        statusCode: 409,
        statusMessage: 'This person may already be a patient',
        data: { candidates },
      })
    }

    patientId = await createPatientFromLead(supabase, teamMember.account_id, lead, {
      // Someone who sees only their own patients has to be this patient's
      // practitioner, or the record they have just created is one they
      // cannot open -- and the phone number would be refused with it.
      defaultPractitionerId: scope === 'own' ? teamMember.id : null,
      defaultCountry,
    })
  }

  const claim = await claimConvertedLead(supabase, teamMember.account_id, id, patientId!, { linked: Boolean(linkPatientId), source: lead.source })
  if (!claim.claimed) return { patientId: claim.patientId, created: false, alreadyConverted: true }

  // Ends at once any run whose rule exits on conversion, rather than at its
  // next step (where the converted check would stop it anyway).
  await automationEvent(serverSupabaseServiceRole<Database>(event), teamMember.account_id, { leadId: id }, 'lead.converted', getRequestURL(event).origin)

  return { patientId, created: !linkPatientId, alreadyConverted: false }
})
