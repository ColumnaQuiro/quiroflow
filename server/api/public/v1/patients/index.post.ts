import { PATIENT_LANGUAGES } from '~/utils/apiContract'
import { looksLikePhoneNumber, splitDialPrefix, toE164 } from '~/utils/phone'
import { COUNTRIES } from '~/utils/countries'
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

  // phone_country_code is the two-letter country (ES), as QuiroFlow stores it
  // -- the code defaulted to "+34", which countryByCode() does not know, so
  // every local number ("612 345 678") was refused as unreadable and only
  // full international numbers got through. "+34" / "34" are still accepted
  // and read as the country they dial.
  // "0034…" is the dialled form of "+34…"; splitDialPrefix only reads the "+".
  const phone = str(body, 'phone', { max: 32 })?.replace(/^\s*00/, '+')
  const { data: account } = await loose(supabase).from('accounts').select('default_phone_country').eq('id', accountId).maybeSingle()
  const phoneCountryCode = countryFromApi(str(body, 'phone_country_code', { max: 8 })) ?? (account as { default_phone_country?: string } | null)?.default_phone_country ?? 'ES'
  if (phone && (!toE164(phone, phoneCountryCode) || !looksLikePhoneNumber(phone, phoneCountryCode))) {
    throw badRequest(`"phone" could not be read as a phone number. Send it in E.164 form (+34612345678), or a local number with phone_country_code as a two-letter country ("ES").`, 'phone')
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
    preferred_language: enumValue(body, 'preferred_language', PATIENT_LANGUAGES),
    tags: stringArray(body, 'tags'),
    external_reference: externalReference,
  })

  const { data, error } = await loose(supabase).from('patients').insert(insert as never).select(patientsResource.select).single()
  if (error) throw new ApiError('server_error', error.message)
  const created = asRow(data)

  if (phone) {
    // Separate table, and its trigger is what flips patients.has_phone --
    // so this has to be a real insert, not a column on the patient.
    // Country and national number apart, as every screen in QuiroFlow writes
    // them: the screens print countryByCode(country_code).dial + number, so a
    // number stored with its own "+34" read "+34 +34 612…" (see 0078).
    const split = splitDialPrefix(phone, phoneCountryCode)
    const { error: numberError } = await loose(supabase).from('patient_contact_numbers').insert({
      account_id: accountId,
      patient_id: created.id,
      number: split.number,
      country_code: split.countryCode,
      is_whatsapp: true,
    } as never)
    // The patient exists by now; a number that silently failed to save is one
    // nobody will ever message, so say so rather than answer 201 as if whole.
    if (numberError) throw new ApiError('server_error', `The patient was created (id ${created.id}) but the phone number was not saved: ${numberError.message}`)
  }

  setResponseStatus(event, 201)
  return { data: patientsResource.serialize(created) }
})

// "ES", or a dial code ("+34", "34") read as the country it dials -- the API
// documented "+34" as the default, so integrations may well be sending it.
function countryFromApi(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^[a-z]{2}$/i.test(trimmed)) return trimmed.toUpperCase()
  const digits = trimmed.replace(/\D/g, '')
  const match = digits ? COUNTRIES.find((c) => c.dial.replace('+', '') === digits) : undefined
  if (!match) throw badRequest('"phone_country_code" must be a two-letter country such as "ES".', 'phone_country_code')
  return match.code
}
