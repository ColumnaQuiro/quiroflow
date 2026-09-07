import { toE164 } from '~/utils/phone'
import { ApiError, defineApiHandler, badRequest } from '~/server/utils/publicApi'
import { asRow, assertBelongsToAccount, loose } from '~/server/utils/publicApiHandlers'
import { bool, dateOnly, definedOnly, email, enumValue, readApiBody, rejectUnknownFields, str, stringArray, uuid } from '~/server/utils/publicApiBody'
import { patientsResource } from '~/server/utils/publicApiResources'

const FIELDS = [
  'first_name', 'last_name', 'email', 'phone', 'phone_country_code', 'date_of_birth', 'gender',
  'status', 'clinic_id', 'default_practitioner_id', 'address', 'city', 'postal_code', 'country',
  'national_id', 'occupation', 'emergency_contact', 'referral_source', 'is_minor', 'do_not_contact',
  'preferred_language', 'tags', 'external_reference',
]

// Creating a patient is the half of "book an appointment for someone who
// isn't in the system yet" that the appointments endpoint deliberately does
// not do for you -- an appointment write that silently creates patients is
// how duplicate records get made at scale.
export default defineApiHandler({ scope: 'patients:write' }, async ({ event, supabase, accountId }) => {
  const body = await readApiBody(event)
  rejectUnknownFields(body, FIELDS)

  const clinicId = uuid(body, 'clinic_id')
  const practitionerId = uuid(body, 'default_practitioner_id')
  // Every foreign key is checked against this account before the insert, so
  // a caller can't attach their patient to another clinic's record by
  // guessing an id. The FK constraint alone wouldn't catch that: it only
  // proves the row exists somewhere, not that it's theirs.
  if (clinicId) await assertBelongsToAccount(supabase, 'clinics', clinicId, accountId, 'clinic_id')
  if (practitionerId) await assertBelongsToAccount(supabase, 'team_members', practitionerId, accountId, 'default_practitioner_id', { deleted_at: null })

  const externalReference = str(body, 'external_reference', { max: 255 })
  if (externalReference) {
    const { data: existing } = await loose(supabase)
      .from('patients')
      .select('id')
      .eq('account_id', accountId)
      .eq('external_reference', externalReference)
      .maybeSingle()
    if (existing) {
      throw new ApiError('conflict', `A patient with external_reference "${externalReference}" already exists (id ${existing.id}). Use PATCH to update it.`, 'external_reference')
    }
  }

  const phone = str(body, 'phone', { max: 32 })
  const phoneCountryCode = str(body, 'phone_country_code', { max: 8 }) ?? '+34'
  if (phone && !toE164(phone, phoneCountryCode)) {
    throw badRequest(`"phone" could not be read as a phone number. Send it in E.164 form (+34612345678) or pass phone_country_code alongside a local number.`, 'phone')
  }

  const insert = definedOnly({
    account_id: accountId,
    first_name: str(body, 'first_name', { required: true, max: 120 }),
    last_name: str(body, 'last_name', { max: 120 }),
    email: email(body, 'email'),
    date_of_birth: dateOnly(body, 'date_of_birth'),
    gender: str(body, 'gender', { max: 40 }),
    status: enumValue(body, 'status', ['active', 'inactive'] as const),
    clinic_id: clinicId,
    default_practitioner_id: practitionerId,
    address: str(body, 'address', { max: 500 }),
    city: str(body, 'city', { max: 120 }),
    postal_code: str(body, 'postal_code', { max: 20 }),
    country: str(body, 'country', { max: 80 }),
    national_id: str(body, 'national_id', { max: 60 }),
    occupation: str(body, 'occupation', { max: 120 }),
    emergency_contact: str(body, 'emergency_contact', { max: 255 }),
    referral_source: str(body, 'referral_source', { max: 120 }),
    is_minor: bool(body, 'is_minor'),
    do_not_contact: bool(body, 'do_not_contact'),
    preferred_language: enumValue(body, 'preferred_language', ['es', 'en'] as const),
    tags: stringArray(body, 'tags'),
    external_reference: externalReference,
  })

  const { data, error } = await loose(supabase).from('patients').insert(insert as never).select(patientsResource.select).single()
  if (error) throw new ApiError('server_error', error.message)
  const created = asRow(data)

  if (phone) {
    // Separate table, and its trigger is what flips patients.has_phone --
    // so this has to be a real insert, not a column on the patient.
    await loose(supabase).from('patient_contact_numbers').insert({
      account_id: accountId,
      patient_id: created.id,
      number: phone,
      country_code: phoneCountryCode,
      is_whatsapp: true,
    } as never)
  }

  setResponseStatus(event, 201)
  return { data: patientsResource.serialize(created) }
})
