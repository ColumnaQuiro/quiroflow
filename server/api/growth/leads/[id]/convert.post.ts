import { requireGrowth } from '~/server/utils/requireGrowth'

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
 *    would produce a patient the clinic cannot message.
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

    const [firstName, ...rest] = lead.full_name.trim().split(/\s+/)
    const { data: patient, error } = await supabase
      .from('patients')
      .insert({
        account_id: teamMember.account_id,
        clinic_id: lead.clinic_id,
        first_name: firstName || lead.full_name,
        last_name: rest.join(' ') || null,
        email: lead.email,
        // Where they came from, kept on the patient so the acquisition story
        // survives on the record itself and not only on the lead.
        referral_source: lead.source,
      })
      .select('id')
      .single()

    if (error) {
      // The RLS policy is the real gate; this is what it looks like when the
      // explicit check above has been outgrown by a policy change.
      throw createError({ statusCode: 403, statusMessage: `Could not create the patient record: ${error.message}` })
    }
    patientId = patient.id

    if (lead.phone) {
      await supabase.from('patient_contact_numbers').insert({
        account_id: teamMember.account_id,
        patient_id: patientId,
        number: lead.phone,
        is_whatsapp: true,
      })
    }
  }

  // Claim the lead only if nothing else already did. Two requests racing --
  // a double click, or two people on the same lead -- both get here, and
  // this is what stops the second from overwriting the first's patient_id
  // and orphaning a record nobody will notice.
  const { data: claimed } = await supabase
    .from('leads')
    .update({ stage: 'converted', patient_id: patientId, converted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('account_id', teamMember.account_id)
    .is('patient_id', null)
    .select('id')
    .maybeSingle()

  if (!claimed) {
    // Someone won the race. Return whichever patient the lead actually
    // points at, not the one this request may have just created.
    const { data: settled } = await supabase.from('leads').select('patient_id').eq('id', id).maybeSingle()
    return { patientId: settled?.patient_id ?? patientId, created: false, alreadyConverted: true }
  }

  await supabase.from('lead_events').insert({
    account_id: teamMember.account_id,
    lead_id: id,
    kind: 'note',
    title: linkPatientId ? 'Linked to an existing patient' : 'Converted to a patient',
    detail: lead.source ? `Attribution kept: ${lead.source}` : null,
  })

  return { patientId, created: !linkPatientId, alreadyConverted: false }
})

type Supa = Awaited<ReturnType<typeof requireGrowth>>['supabase']

/** Existing patients sharing this lead's phone or email. */
async function findLikelyExistingPatients(supabase: Supa, accountId: string, phone: string | null, email: string | null) {
  const found = new Map<string, { id: string; name: string; reason: string }>()

  if (phone) {
    const { data } = await supabase
      .from('patient_contact_numbers')
      .select('patients(id, first_name, last_name)')
      .eq('account_id', accountId)
      .eq('number', phone)
      .limit(5)

    for (const row of data ?? []) {
      const p = row.patients
      if (p) found.set(p.id, { id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(' '), reason: 'Same phone number' })
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
