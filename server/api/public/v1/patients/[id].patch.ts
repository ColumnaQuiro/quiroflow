import { ApiError, defineApiHandler, notFound } from '~/server/utils/publicApi'
import { assertUuid } from '~/server/utils/publicApiQuery'
import { bool, dateOnly, definedOnly, email, enumValue, readApiBody, rejectUnknownFields, str, stringArray, uuid } from '~/server/utils/publicApiBody'
import { assertBelongsToAccount, loose } from '~/server/utils/publicApiHandlers'
import { patientsResource } from '~/server/utils/publicApiResources'

// Phone deliberately isn't updatable here: a patient can have several
// numbers with different WhatsApp flags, and a single "phone" field on PATCH
// would have to guess which one it meant. Numbers get their own endpoints
// when there's a caller that needs them.
const FIELDS = [
  'first_name', 'last_name', 'email', 'date_of_birth', 'gender', 'status', 'clinic_id',
  'default_practitioner_id', 'address', 'city', 'postal_code', 'country', 'national_id',
  'occupation', 'emergency_contact', 'referral_source', 'is_minor', 'do_not_contact',
  'preferred_language', 'tags', 'external_reference',
]

export default defineApiHandler({ scope: 'patients:write' }, async ({ event, supabase, accountId }) => {
  const id = assertUuid(getRouterParam(event, 'id'), 'id')
  const body = await readApiBody(event)
  rejectUnknownFields(body, FIELDS)

  const { data: existing } = await loose(supabase).from('patients').select('id').eq('account_id', accountId).eq('id', id).maybeSingle()
  if (!existing) throw notFound('patient')

  const clinicId = uuid(body, 'clinic_id')
  const practitionerId = uuid(body, 'default_practitioner_id')
  if (clinicId) await assertBelongsToAccount(supabase, 'clinics', clinicId, accountId, 'clinic_id')
  if (practitionerId) await assertBelongsToAccount(supabase, 'team_members', practitionerId, accountId, 'default_practitioner_id', { deleted_at: null })

  const patch = definedOnly({
    first_name: str(body, 'first_name', { max: 120 }),
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
    external_reference: str(body, 'external_reference', { max: 255 }),
  })

  if (Object.keys(patch).length === 0) {
    throw new ApiError('invalid_request', `Nothing to update. Send at least one of: ${FIELDS.join(', ')}.`)
  }

  const { data: updated, error } = await loose(supabase)
    .from('patients')
    .update(patch as never)
    .eq('account_id', accountId)
    .eq('id', id)
    .select(patientsResource.select)
    .single()
  if (error) throw new ApiError('server_error', error.message)

  return { data: patientsResource.serialize(updated) }
})
