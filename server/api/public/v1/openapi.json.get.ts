import { API_SCOPES, RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_SECONDS, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '~/server/utils/publicApi'
import { API_RESOURCES } from '~/server/utils/publicApiResources'
import type { ApiResource } from '~/server/utils/publicApiResources'

// The machine-readable contract behind developers.quiroflow.com. It's public
// and unauthenticated on purpose -- the portal's reference page renders from
// it, and an integrator should be able to generate a client before they have
// a token, not after.
//
// Filter and sort parameters are generated from the same resource registry
// the handlers use, so the documented filters and the accepted filters are
// the same list by construction. Only the response shapes below are written
// by hand, and those are the part a column list can't infer.

const OPERATOR_HELP =
  'Filter operators: `eq` (default), `ne`, `gt`, `gte`, `lt`, `lte`, `like` (case-insensitive contains), ' +
  '`in` / `not-in` (comma-separated), `between` (two comma-separated bounds), `null`, `not-null`. ' +
  'Written as `field=operator:value`, e.g. `starts_at=gte:2026-03-01T00:00:00Z`. A bare `field=value` means `eq`.'

export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'application/json; charset=utf-8')
  // Small and public, but regenerated on every deploy -- a short cache keeps
  // the reference page snappy without pinning a stale contract for long.
  setHeader(event, 'Cache-Control', 'public, max-age=300')

  return {
    openapi: '3.1.0',
    info: {
      title: 'QuiroFlow API',
      version: '1.0.0',
      description: [
        'The QuiroFlow API is REST over HTTPS with JSON request and response bodies.',
        '',
        `Authenticate with a bearer token created in QuiroFlow under **Settings → Developers**. Each token is scoped, and belongs to one clinic account — every response is already limited to that account's data.`,
        '',
        `Rate limit: **${RATE_LIMIT_REQUESTS} requests per ${RATE_LIMIT_WINDOW_SECONDS} seconds** per token.`,
        '',
        'All timestamps are UTC ISO 8601. All money is in integer cents.',
      ].join('\n'),
      contact: { name: 'QuiroFlow support', url: 'https://developers.quiroflow.com' },
    },
    servers: [{ url: 'https://app.quiroflow.com/api/public/v1', description: 'Production' }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Patients', description: 'Patient records and contact details.' },
      { name: 'Appointments', description: 'Bookings, rescheduling, cancellation and free-slot lookup.' },
      { name: 'Growth', description: 'Leads captured from ad platforms and forms.' },
      { name: 'Catalog', description: 'Clinics, practitioners, appointment types and services — the reference data everything else points at.' },
      { name: 'Billing', description: 'Invoices and payments (read-only in v1).' },
      { name: 'Messaging', description: 'Send WhatsApp messages as the clinic.' },
    ],
    paths: {
      ...collection('/patients', API_RESOURCES.patients, 'Patients', ['patient', 'patients'], 'Patient', { detail: true, create: true, update: true }),
      '/patients/lookup': lookupPath(),
      '/leads': leadsPath(),
      ...collection('/appointments', API_RESOURCES.appointments, 'Appointments', ['appointment', 'appointments'], 'Appointment', { detail: true, create: true, update: true, cancel: true }),
      '/availability': availabilityPath(),
      ...collection('/practitioners', API_RESOURCES.practitioners, 'Catalog', ['practitioner', 'practitioners'], 'Practitioner', {}),
      ...collection('/clinics', API_RESOURCES.clinics, 'Catalog', ['clinic', 'clinics'], 'Clinic', {}),
      ...collection('/appointment-types', API_RESOURCES['appointment-types'], 'Catalog', ['appointment type', 'appointment types'], 'AppointmentType', {}),
      ...collection('/services', API_RESOURCES.services, 'Catalog', ['service or product', 'services and products'], 'Service', {}),
      ...collection('/invoices', API_RESOURCES.invoices, 'Billing', ['invoice', 'invoices'], 'Invoice', { detail: true }),
      ...collection('/payments', API_RESOURCES.payments, 'Billing', ['payment', 'payments'], 'Payment', {}),
      '/whatsapp/send': whatsappPath(),
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'A token from Settings → Developers, sent as `Authorization: Bearer qf_live_…`.',
        },
      },
      schemas: schemas(),
    },
  }
})

// ---------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------

interface CollectionOptions {
  detail?: boolean
  create?: boolean
  update?: boolean
  cancel?: boolean
}

// `label` is [singular, plural]. Suffixing an "s" and prefixing an "a" got
// us "List service or products" and "Create a appointment" -- generated docs
// that read as generated, on the page meant to inspire confidence.
function collection(path: string, resource: ApiResource, tag: string, label: [string, string], schema: string, options: CollectionOptions) {
  const [one, many] = label
  const a = /^[aeiou]/i.test(one) ? 'an' : 'a'
  const paths: Record<string, unknown> = {
    [path]: {
      get: {
        tags: [tag],
        summary: `List ${many}`,
        description: OPERATOR_HELP,
        security: [{ bearerAuth: [resource.scope] }],
        parameters: [...paginationParams(), orderParam(resource), ...filterParams(resource)],
        responses: {
          200: listResponse(schema),
          400: errorResponse('An unknown filter, an unsortable `order` field, or a malformed value.'),
          401: errorResponse('Missing, invalid, revoked or expired token.'),
          403: errorResponse(`Token is missing the \`${resource.scope}\` scope.`),
          429: errorResponse('Rate limit exceeded.'),
        },
      },
      ...(options.create ? { post: createOperation(tag, one, schema, resource.scope.replace(':read', ':write')) } : {}),
    },
  }

  if (options.detail || options.update || options.cancel) {
    paths[`${path}/{id}`] = {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: `The ${one}'s id.` }],
      ...(options.detail
        ? {
            get: {
              tags: [tag],
              summary: `Retrieve ${a} ${one}`,
              security: [{ bearerAuth: [resource.scope] }],
              responses: {
                200: objectResponse(`${schema}Detail`),
                404: errorResponse(`No ${one} with that id in this account.`),
              },
            },
          }
        : {}),
      ...(options.update
        ? {
            patch: {
              tags: [tag],
              summary: `Update ${a} ${one}`,
              description: 'Only the fields you send are changed. Unknown fields are rejected rather than ignored.',
              security: [{ bearerAuth: [resource.scope.replace(':read', ':write')] }],
              requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}Update` } } } },
              responses: {
                200: objectResponse(schema),
                400: errorResponse('Validation failed. `error.field` names the offending field.'),
                404: errorResponse(`No ${one} with that id in this account.`),
                409: errorResponse('The change would double-book the practitioner.'),
              },
            },
          }
        : {}),
      ...(options.cancel
        ? {
            delete: {
              tags: [tag],
              summary: `Cancel ${a} ${one}`,
              description:
                'Sets `status` to `cancelled`. The appointment is **not** erased — it stays in the record and in reporting. Idempotent: cancelling an already-cancelled appointment returns 200.',
              security: [{ bearerAuth: [resource.scope.replace(':read', ':write')] }],
              responses: { 200: objectResponse(schema), 404: errorResponse('No appointment with that id in this account.') },
            },
          }
        : {}),
    }
  }
  return paths
}

function createOperation(tag: string, label: string, schema: string, scope: string) {
  const a = /^[aeiou]/i.test(label) ? 'an' : 'a'
  return {
    tags: [tag],
    summary: `Create ${a} ${label}`,
    security: [{ bearerAuth: [scope] }],
    requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}Create` } } } },
    responses: {
      201: objectResponse(schema),
      400: errorResponse('Validation failed. `error.field` names the offending field.'),
      409: errorResponse(`A conflicting ${label} already exists.`),
    },
  }
}

function leadsPath() {
  return {
    post: {
      tags: ['Growth'],
      summary: 'Create a lead from an ad platform or form',
      description: [
        'Posts an enquiry in from wherever it was captured — a Meta lead-ad form, a landing page, a form builder — and files it in three places: the lead itself, its attribution, and the answers the person gave.',
        '',
        '**Send `external_id`.** With it, this endpoint is idempotent: a redelivery of the same submission returns the lead already created, with `deduplicated: true` and a 200, instead of making a second one. Ad platforms redeliver whenever they do not get a clean 200, so without it a retry becomes a duplicate lead, a duplicate welcome message, and a double count in the funnel.',
        '',
        'Either `phone` or `email` is required — a lead with neither cannot be contacted. Names may be sent as `full_name` or as `first_name`/`last_name`.',
        '',
        '`answers` accepts either `[{ question, answer }]` or a plain object of question/answer pairs — so you can pass an ad platform\'s raw field bag (Meta\'s `data`) straight through. Keys that are lead fields rather than questions (name, email, phone, address) are dropped, underscores become spaces, list answers are joined, and blank answers are omitted. The object form is what survives a new campaign: new questions arrive as new keys with no mapping to edit.',
      ].join('\n'),
      security: [{ bearerAuth: ['leads:write'] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['full_name'],
              properties: {
                full_name: { type: 'string', description: 'Or send first_name / last_name and they are joined.' },
                first_name: text(),
                last_name: text(),
                phone: { type: 'string', description: 'E.164, or a local number with phone_country_code. Required unless email is given.' },
                phone_country_code: { type: 'string', default: '+34' },
                email: { type: 'string', format: 'email', description: 'Required unless phone is given.' },
                channel: { type: 'string', enum: ['whatsapp', 'sms', 'phone', 'web', 'instagram', 'facebook', 'walk_in'], default: 'facebook' },
                source: { type: 'string', description: 'Campaign or referrer, e.g. "Meta Ads · Sciatica". The dashboard groups spend by the part before the "·".' },
                stage: { type: 'string', enum: ['new', 'contacted', 'qualified', 'booked'], default: 'new', description: 'Outcomes (converted, lost) are the clinic\'s to set, not a form\'s.' },
                clinic_id: uuid(),
                estimated_value_cents: { type: 'integer', minimum: 0 },
                external_id: { type: 'string', description: 'The platform\'s own id for this submission. Send it — see above.' },
                external_source: { type: 'string', default: 'facebook', description: 'Which platform external_id belongs to.' },
                occurred_at: { type: 'string', format: 'date-time', description: 'When the person submitted, if that differs from now.' },
                attribution: {
                  type: 'object',
                  properties: {
                    campaign: text(), ad: text(), audience: text(),
                    first_touch: text(), last_touch: text(),
                    cost_cents: { type: 'integer', minimum: 0 },
                  },
                },
                answers: {
                  description: 'Either a list of question/answer objects, or a plain object of question/answer pairs.',
                  oneOf: [
                    {
                      type: 'array',
                      maxItems: 50,
                      items: {
                        type: 'object',
                        required: ['question'],
                        properties: { question: { type: 'string' }, answer: { type: 'string' } },
                      },
                    },
                    {
                      type: 'object',
                      additionalProperties: { type: ['string', 'number', 'boolean', 'array'] },
                      example: { '¿cuál_sería_el_motivo_de_tu_visita?': 'dolor lumbar' },
                    },
                  ],
                },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'The lead was created.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: {
                    type: 'object',
                    properties: {
                      id: uuid(),
                      reference: { type: 'string', example: 'LEAD-2026-0042' },
                      stage: { type: 'string' },
                      created_at: { type: 'string', format: 'date-time' },
                      deduplicated: { type: 'boolean', description: 'False on a create.' },
                    },
                  },
                },
              },
            },
          },
        },
        200: { description: 'This external_id was already received; the existing lead is returned with `deduplicated: true`. Nothing was created.' },
        400: errorResponse('Neither phone nor email was given, a field failed validation, or an unknown field was sent.'),
      },
    },
  }
}

function lookupPath() {
  return {
    get: {
      tags: ['Patients'],
      summary: 'Check whether someone is already a patient',
      description: [
        'Answers "has this person already become a patient here?" without you having to page through the patient list — the check a lead-capture workflow wants before treating someone as a brand-new enquiry.',
        '',
        'Matches on `email` (exact, case-insensitive) and/or `phone`. Phone matching tolerates formatting and a wrong or missing country code on the stored number, so a lead who typed their number differently still matches. Either parameter is enough; giving both matches on either.',
        '',
        'Note this endpoint predates the rest of v1 and its response is camelCase (`firstName`, `lastName`). That is kept as-is so existing integrations keep working.',
      ].join('\n'),
      security: [{ bearerAuth: ['patients:read'] }],
      parameters: [
        { name: 'email', in: 'query', schema: { type: 'string' }, description: 'At least one of `email` / `phone` is required.' },
        { name: 'phone', in: 'query', schema: { type: 'string' }, description: 'Any format — digits are extracted automatically.' },
      ],
      responses: {
        200: {
          description: 'Whether a matching patient exists.',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  converted: { type: 'boolean', description: 'True if a patient matched.' },
                  patient: {
                    type: 'object',
                    nullable: true,
                    description: 'The earliest-created matching patient, or null.',
                    properties: { id: uuid(), firstName: { type: 'string' }, lastName: text(), email: text() },
                  },
                },
              },
            },
          },
        },
        400: errorResponse('Neither `email` nor `phone` was given.'),
      },
    },
  }
}

function availabilityPath() {
  return {
    get: {
      tags: ['Appointments'],
      summary: 'List free slots',
      description: [
        'Returns bookable slots for an appointment type, day by day, applying the same rules as the clinic’s own booking page:',
        '',
        '- a practitioner’s own weekly hours are authoritative and are **not** narrowed by the clinic’s;',
        '- the clinic’s hours are the fallback for a practitioner who has never set their own;',
        '- slots step by the appointment’s own length, so anything returned here is bookable as-is;',
        '- existing appointments and availability blocks remove slots, and slots in the past are omitted.',
        '',
        'Unlike the public booking page this includes practitioners whose `online_booking_enabled` is false — an authenticated integration acts for the clinic. The flag is returned per practitioner so a patient-facing widget can filter on it.',
      ].join('\n'),
      security: [{ bearerAuth: ['appointments:read'] }],
      parameters: [
        { name: 'clinic_id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'appointment_type_id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Decides slot length, including any per-practitioner override.' },
        { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date' }, description: 'First day, `YYYY-MM-DD`, in the clinic’s timezone.' },
        { name: 'to', in: 'query', required: true, schema: { type: 'string', format: 'date' }, description: 'Last day, inclusive. At most 62 days from `from`.' },
        { name: 'practitioner_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Restrict to one practitioner. Omit to get every practitioner’s slots.' },
      ],
      responses: { 200: objectResponse('Availability'), 400: errorResponse('Missing or malformed parameter, or a range longer than 62 days.') },
    },
  }
}

function whatsappPath() {
  return {
    post: {
      tags: ['Messaging'],
      summary: 'Send a WhatsApp message',
      description: [
        'Sends as the clinic’s own WhatsApp number. Two kinds of message:',
        '',
        '- **Template** (`template_name`) — works at any time, must be pre-approved in Settings → WhatsApp.',
        '- **Free text** (`text`) — only within 24 hours of the recipient’s last inbound message. That is a WhatsApp platform rule, not a QuiroFlow one.',
        '',
        'Patients marked *do not contact*, and patients recorded as minors, are refused.',
      ].join('\n'),
      security: [{ bearerAuth: ['whatsapp:send'] }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/WhatsAppSend' } } } },
      responses: {
        200: {
          description: 'Sent.',
          content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, wamid: { type: 'string', nullable: true } } } } },
        },
        400: errorResponse('WhatsApp not configured, outside the 24h window, or the patient cannot be contacted.'),
        502: errorResponse('WhatsApp rejected the send; the message from Meta is passed through.'),
      },
    },
  }
}

// ---------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------

function paginationParams() {
  return [
    { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 }, description: 'Page number, 1-based.' },
    {
      name: 'page_size',
      in: 'query',
      schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
      description: `Records per page. Values above ${MAX_PAGE_SIZE} are clamped rather than rejected.`,
    },
  ]
}

function orderParam(resource: ApiResource) {
  return {
    name: 'order',
    in: 'query',
    schema: { type: 'string', enum: resource.sortable.flatMap((c) => [`${c}.asc`, `${c}.desc`]) },
    description: `Sort order, \`field.asc\` or \`field.desc\`. Default \`${resource.defaultOrder.column}.${resource.defaultOrder.ascending ? 'asc' : 'desc'}\`.`,
  }
}

function filterParams(resource: ApiResource) {
  return Object.entries(resource.filterable).map(([field, type]) => ({
    name: field,
    in: 'query',
    schema: { type: 'string' },
    description: `Filter on \`${field}\`, a ${type}. Accepts any of the operators above.`,
  }))
}

// ---------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------

function listResponse(schema: string) {
  return {
    description: 'A page of results.',
    headers: rateLimitHeaders(),
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['total_entries', 'data', 'links'],
          properties: {
            total_entries: { type: 'integer', description: 'Total matching records across every page, not just this one.' },
            data: { type: 'array', items: { $ref: `#/components/schemas/${schema}` } },
            links: { $ref: '#/components/schemas/PaginationLinks' },
          },
        },
      },
    },
  }
}

function objectResponse(schema: string) {
  return {
    description: 'Success.',
    headers: rateLimitHeaders(),
    content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: `#/components/schemas/${schema}` } } } } },
  }
}

function errorResponse(description: string) {
  return { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
}

function rateLimitHeaders() {
  return {
    'X-QuiroFlow-Request-Id': { schema: { type: 'string', format: 'uuid' }, description: 'Quote this when reporting a problem — it identifies the request in the clinic’s usage log.' },
    'X-RateLimit-Limit': { schema: { type: 'integer' }, description: 'Requests allowed per window.' },
    'X-RateLimit-Remaining': { schema: { type: 'integer' }, description: 'Requests left in the current window.' },
    'X-RateLimit-Reset': { schema: { type: 'integer' }, description: 'Seconds until the window resets.' },
  }
}

// ---------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------

const uuid = (description?: string) => ({ type: 'string', format: 'uuid', ...(description ? { description } : {}) })
const datetime = (description?: string) => ({ type: 'string', format: 'date-time', nullable: true, ...(description ? { description } : {}) })
const text = (description?: string) => ({ type: 'string', nullable: true, ...(description ? { description } : {}) })
const cents = (description: string) => ({ type: 'integer', description })

// PatientCreate minus the two phone fields, which only exist on create.
function patientWritableProperties() {
  const { phone, phone_country_code, ...rest } = createPatientProperties()
  void phone
  void phone_country_code
  return rest
}

function schemas() {
  return {
    Error: {
      type: 'object',
      properties: {
        error: {
          type: 'object',
          required: ['status', 'code', 'message', 'request_id'],
          properties: {
            status: { type: 'integer' },
            code: { type: 'string', enum: ['unauthorized', 'forbidden', 'not_found', 'invalid_request', 'rate_limited', 'conflict', 'bad_gateway', 'server_error'] },
            message: { type: 'string', description: 'Human-readable and safe to show to whoever is debugging.' },
            field: { type: 'string', description: 'Present on validation errors — names the field at fault.' },
            request_id: uuid('Matches the X-QuiroFlow-Request-Id header and the clinic’s usage log.'),
          },
        },
      },
    },
    PaginationLinks: {
      type: 'object',
      description: 'Follow these rather than building your own URLs — they carry your filters forward.',
      properties: {
        previous: { type: 'string', nullable: true },
        self: { type: 'string' },
        next: { type: 'string', nullable: true, description: 'null on the last page.' },
      },
    },
    Address: {
      type: 'object',
      properties: { line1: text(), city: text(), postal_code: text(), country: text() },
    },
    Patient: {
      type: 'object',
      properties: {
        id: uuid(),
        first_name: { type: 'string' },
        last_name: text(),
        email: text(),
        date_of_birth: { type: 'string', format: 'date', nullable: true },
        gender: text(),
        status: { type: 'string', enum: ['active', 'inactive'] },
        clinic_id: { ...uuid(), nullable: true },
        default_practitioner_id: { ...uuid(), nullable: true },
        address: { $ref: '#/components/schemas/Address' },
        national_id: text(),
        occupation: text(),
        emergency_contact: text(),
        referral_source: text(),
        referred_by_patient_id: { ...uuid(), nullable: true },
        tutor_patient_id: { ...uuid(), nullable: true, description: 'For a minor, the patient record of their guardian.' },
        is_minor: { type: 'boolean' },
        do_not_contact: { type: 'boolean', description: 'When true, messaging and API booking for this patient are refused.' },
        preferred_language: { type: 'string', enum: ['es', 'en'] },
        reminder_channel: { type: 'string' },
        confirmation_channel: { type: 'string' },
        marketing_channels: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        recall_status: { type: 'string' },
        recall_priority: { type: 'boolean' },
        balance_cents: cents('Outstanding balance. Negative means the patient is in credit.'),
        external_reference: text('Your own identifier for this patient. Unique per account — useful as an idempotency key on create.'),
        created_at: datetime(),
      },
    },
    PatientDetail: {
      allOf: [
        { $ref: '#/components/schemas/Patient' },
        {
          type: 'object',
          properties: {
            contact_numbers: {
              type: 'array',
              description: 'Only returned on the single-patient endpoint.',
              items: {
                type: 'object',
                properties: { id: uuid(), number: { type: 'string' }, country_code: { type: 'string' }, is_whatsapp: { type: 'boolean' } },
              },
            },
          },
        },
      ],
    },
    PatientCreate: {
      type: 'object',
      required: ['first_name'],
      properties: createPatientProperties(),
    },
    PatientUpdate: {
      type: 'object',
      description:
        'Every field is optional; only what you send is changed. Phone numbers are deliberately not editable here — a patient can have several, and one `phone` field would have to guess which.',
      properties: patientWritableProperties(),
    },
    Appointment: {
      type: 'object',
      properties: {
        id: uuid(),
        patient_id: uuid(),
        clinic_id: uuid(),
        practitioner_id: { ...uuid(), nullable: true },
        appointment_type_id: { ...uuid(), nullable: true },
        room_id: { ...uuid(), nullable: true },
        starts_at: { type: 'string', format: 'date-time' },
        ends_at: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['booked', 'completed', 'cancelled', 'no_show'] },
        note: text(),
        source: { type: 'string', enum: ['staff', 'online', 'api'], description: '`api` for anything booked through this API; `online` means the clinic’s own booking page.' },
        rescheduled: { type: 'boolean' },
        checked_in_at: datetime(),
        confirmation_status: text(),
        confirmation_sent_at: datetime(),
        reminder_sent_at: datetime(),
        external_reference: text(),
        created_at: datetime(),
      },
    },
    AppointmentDetail: { $ref: '#/components/schemas/Appointment' },
    AppointmentCreate: {
      type: 'object',
      required: ['patient_id', 'clinic_id', 'starts_at'],
      description: 'Send either `ends_at` or `appointment_type_id` so the appointment has a length. This endpoint never creates patients — create the patient first.',
      properties: {
        patient_id: uuid(),
        clinic_id: uuid(),
        practitioner_id: uuid(),
        appointment_type_id: uuid('Decides the length when `ends_at` is omitted, honouring any per-practitioner override.'),
        room_id: uuid(),
        starts_at: { type: 'string', format: 'date-time' },
        ends_at: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['booked', 'completed', 'cancelled', 'no_show'], default: 'booked' },
        note: { type: 'string', maxLength: 2000 },
        external_reference: { type: 'string' },
      },
    },
    AppointmentUpdate: {
      type: 'object',
      description: '`patient_id` and `clinic_id` are not patchable — cancel and rebook instead. Sending `starts_at` marks the appointment as rescheduled.',
      properties: {
        practitioner_id: uuid(),
        appointment_type_id: uuid(),
        room_id: uuid(),
        starts_at: { type: 'string', format: 'date-time' },
        ends_at: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['booked', 'completed', 'cancelled', 'no_show'] },
        note: { type: 'string', maxLength: 2000 },
        external_reference: { type: 'string' },
      },
    },
    Availability: {
      type: 'object',
      properties: {
        clinic_id: uuid(),
        timezone: { type: 'string', description: 'IANA name. Slot times are UTC; this is what the clinic’s opening hours are relative to.' },
        appointment_type_id: uuid(),
        practitioners: {
          type: 'array',
          items: { type: 'object', properties: { id: uuid(), full_name: { type: 'string' }, online_booking_enabled: { type: 'boolean' } } },
        },
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', format: 'date' },
              slots: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    starts_at: { type: 'string', format: 'date-time' },
                    ends_at: { type: 'string', format: 'date-time' },
                    practitioner_id: uuid(),
                  },
                },
              },
            },
          },
        },
      },
    },
    Practitioner: {
      type: 'object',
      properties: {
        id: uuid(),
        full_name: { type: 'string' },
        role: { type: 'string' },
        is_owner: { type: 'boolean' },
        color: { type: 'string', description: 'Calendar colour, hex.' },
        online_booking_enabled: { type: 'boolean' },
        business_hours: { $ref: '#/components/schemas/BusinessHours' },
        created_at: datetime(),
      },
    },
    BusinessHours: {
      type: 'object',
      nullable: true,
      description: 'Weekly opening hours as wall-clock times in the clinic’s timezone. Keys are `sun`–`sat`; each value is a list of `[open, close]` pairs.',
      example: { mon: [['09:00', '13:00'], ['15:00', '20:00']], tue: [['09:00', '14:00']], sun: [] },
      additionalProperties: { type: 'array', items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } },
    },
    Clinic: {
      type: 'object',
      properties: {
        id: uuid(),
        name: { type: 'string' },
        legal_name: text(),
        address: text(),
        phone: text(),
        email: text(),
        tax_id: text(),
        timezone: { type: 'string' },
        business_hours: { $ref: '#/components/schemas/BusinessHours' },
        slot_duration_minutes: { type: 'integer' },
        online_booking_enabled: { type: 'boolean' },
        created_at: datetime(),
      },
    },
    AppointmentType: {
      type: 'object',
      properties: {
        id: uuid(),
        name: { type: 'string' },
        duration_minutes: { type: 'integer' },
        default_price_cents: cents('Price before any per-practitioner override.'),
        color: { type: 'string' },
        stage: text(),
        online_booking_enabled: { type: 'boolean' },
        online_bookable_by: { type: 'string' },
        online_deposit_cents: { type: 'integer', nullable: true },
        online_payment_required: { type: 'boolean' },
        online_max_days_ahead: { type: 'integer', nullable: true },
        created_at: datetime(),
      },
    },
    Service: {
      type: 'object',
      properties: { id: uuid(), name: { type: 'string' }, price_cents: cents('Unit price.'), tax_rate: { type: 'number' }, created_at: datetime() },
    },
    Invoice: {
      type: 'object',
      properties: {
        id: uuid(),
        invoice_number: { type: 'string' },
        patient_id: uuid(),
        appointment_id: { ...uuid(), nullable: true },
        status: { type: 'string', enum: ['unpaid', 'paid', 'void'] },
        total_cents: cents('Invoice total.'),
        is_refund: { type: 'boolean' },
        refunds_invoice_id: { ...uuid(), nullable: true },
        created_at: datetime(),
      },
    },
    InvoiceDetail: {
      allOf: [
        { $ref: '#/components/schemas/Invoice' },
        {
          type: 'object',
          properties: {
            line_items: {
              type: 'array',
              items: { type: 'object', properties: { id: uuid(), description: { type: 'string' }, quantity: { type: 'number' }, price_cents: cents('Unit price.'), service_id: { ...uuid(), nullable: true } } },
            },
            payments: { type: 'array', items: { $ref: '#/components/schemas/Payment' } },
          },
        },
      ],
    },
    Payment: {
      type: 'object',
      properties: {
        id: uuid(),
        invoice_id: uuid(),
        amount_cents: cents('Amount paid.'),
        method: { type: 'string' },
        paid_at: { type: 'string', format: 'date-time' },
        stripe_payment_intent_id: text(),
      },
    },
    WhatsAppSend: {
      type: 'object',
      description:
        'Give `to` or `patient_id`, and `template_name` or `text`. The camelCase spellings (`patientId`, `templateName`, `templateLanguage`) predate the rest of v1 and still work.',
      properties: {
        to: { type: 'string', description: 'E.164 phone number.' },
        patient_id: uuid('QuiroFlow patient id — their number is looked up and do-not-contact rules applied.'),
        template_name: { type: 'string', description: 'An approved WhatsApp template. Works at any time.' },
        template_language: { type: 'string', default: 'es' },
        variables: { type: 'array', items: { type: 'string' }, description: 'Fills the template’s placeholders in order.' },
        text: { type: 'string', description: 'Free text. Only within 24h of the recipient’s last inbound message.' },
      },
    },
    Scopes: {
      type: 'string',
      description: 'Scopes a token can carry.',
      enum: API_SCOPES.map((s) => s.key),
    },
  }
}

// Writable patient fields, shared by PatientCreate and PatientUpdate so the
// two can't document different field sets for the same record.
function createPatientProperties(): Record<string, unknown> {
  return {
    first_name: { type: 'string', maxLength: 120 },
    last_name: { type: 'string', maxLength: 120 },
    email: { type: 'string', format: 'email' },
    phone: { type: 'string', description: 'E.164 (`+34612345678`) or a local number alongside `phone_country_code`.' },
    phone_country_code: { type: 'string', default: '+34' },
    date_of_birth: { type: 'string', format: 'date' },
    gender: { type: 'string' },
    status: { type: 'string', enum: ['active', 'inactive'] },
    clinic_id: uuid(),
    default_practitioner_id: uuid(),
    address: { type: 'string' },
    city: { type: 'string' },
    postal_code: { type: 'string' },
    country: { type: 'string' },
    national_id: { type: 'string' },
    occupation: { type: 'string' },
    emergency_contact: { type: 'string' },
    referral_source: { type: 'string' },
    is_minor: { type: 'boolean' },
    do_not_contact: { type: 'boolean' },
    preferred_language: { type: 'string', enum: ['es', 'en'] },
    tags: { type: 'array', items: { type: 'string' } },
    external_reference: { type: 'string', description: 'Rejected with 409 if another patient in this account already has it.' },
  }
}
