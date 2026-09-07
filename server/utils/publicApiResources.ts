import type { ApiScope } from '~/utils/apiContract'
import type { FilterType } from '~/server/utils/publicApiQuery'

// The single description of every read-only collection the public API
// exposes. List and detail endpoints are generated from these, so "what is
// public" is one reviewable table rather than a fact spread across fifteen
// handlers that drift apart.
//
// Two rules encoded here rather than left to each endpoint:
//
//   * `select` is an explicit column list, never '*'. A column added to a
//     table later must be added here deliberately before it reaches a third
//     party -- the failure mode of '*' is that a future migration silently
//     publishes a new field.
//
//   * `baseFilters` carries the soft-delete and visibility conditions, so a
//     deleted appointment or a deactivated practitioner can't surface just
//     because a handler forgot the condition.

export interface ApiResource {
  table: string
  scope: ApiScope
  select: string
  filterable: Record<string, FilterType>
  sortable: string[]
  defaultOrder: { column: string; ascending: boolean }
  baseFilters?: { column: string; op: 'is_null' | 'eq'; value?: unknown }[]
  serialize: (row: Record<string, any>) => Record<string, unknown>
}

const TIMESTAMPS = { created_at: 'date' } as const

export const patientsResource: ApiResource = {
  table: 'patients',
  scope: 'patients:read',
  select:
    'id, first_name, last_name, email, date_of_birth, gender, status, clinic_id, default_practitioner_id, address, city, postal_code, country, national_id, occupation, emergency_contact, referral_source, referred_by_patient_id, tutor_patient_id, is_minor, do_not_contact, preferred_language, reminder_channel, confirmation_channel, marketing_channels, tags, recall_status, recall_priority, balance_cents, external_reference, created_at',
  filterable: {
    id: 'uuid',
    first_name: 'string',
    last_name: 'string',
    email: 'string',
    date_of_birth: 'date',
    status: 'string',
    clinic_id: 'uuid',
    default_practitioner_id: 'uuid',
    is_minor: 'boolean',
    do_not_contact: 'boolean',
    recall_status: 'string',
    external_reference: 'string',
    ...TIMESTAMPS,
  },
  sortable: ['created_at', 'first_name', 'last_name', 'date_of_birth'],
  defaultOrder: { column: 'created_at', ascending: false },
  serialize: (row) => ({
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    date_of_birth: row.date_of_birth,
    gender: row.gender,
    status: row.status,
    clinic_id: row.clinic_id,
    default_practitioner_id: row.default_practitioner_id,
    address: { line1: row.address, city: row.city, postal_code: row.postal_code, country: row.country },
    national_id: row.national_id,
    occupation: row.occupation,
    emergency_contact: row.emergency_contact,
    referral_source: row.referral_source,
    referred_by_patient_id: row.referred_by_patient_id,
    tutor_patient_id: row.tutor_patient_id,
    is_minor: row.is_minor,
    do_not_contact: row.do_not_contact,
    preferred_language: row.preferred_language,
    reminder_channel: row.reminder_channel,
    confirmation_channel: row.confirmation_channel,
    marketing_channels: row.marketing_channels ?? [],
    tags: row.tags ?? [],
    recall_status: row.recall_status,
    recall_priority: row.recall_priority,
    balance_cents: row.balance_cents,
    external_reference: row.external_reference,
    created_at: row.created_at,
  }),
}

export const appointmentsResource: ApiResource = {
  table: 'appointments',
  scope: 'appointments:read',
  select:
    'id, patient_id, clinic_id, practitioner_id, appointment_type_id, room_id, starts_at, ends_at, status, note, source, rescheduled, checked_in_at, confirmation_status, confirmation_sent_at, reminder_sent_at, external_reference, created_at',
  filterable: {
    id: 'uuid',
    patient_id: 'uuid',
    clinic_id: 'uuid',
    practitioner_id: 'uuid',
    appointment_type_id: 'uuid',
    room_id: 'uuid',
    starts_at: 'date',
    ends_at: 'date',
    status: 'string',
    source: 'string',
    confirmation_status: 'string',
    external_reference: 'string',
    ...TIMESTAMPS,
  },
  sortable: ['starts_at', 'ends_at', 'created_at'],
  defaultOrder: { column: 'starts_at', ascending: false },
  // Cancelling through the API soft-deletes rather than dropping the row, so
  // without this every list would keep returning cancelled-and-removed
  // appointments forever.
  baseFilters: [{ column: 'deleted_at', op: 'is_null' }],
  serialize: (row) => ({
    id: row.id,
    patient_id: row.patient_id,
    clinic_id: row.clinic_id,
    practitioner_id: row.practitioner_id,
    appointment_type_id: row.appointment_type_id,
    room_id: row.room_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
    note: row.note,
    source: row.source,
    rescheduled: row.rescheduled,
    checked_in_at: row.checked_in_at,
    confirmation_status: row.confirmation_status,
    confirmation_sent_at: row.confirmation_sent_at,
    reminder_sent_at: row.reminder_sent_at,
    external_reference: row.external_reference,
    created_at: row.created_at,
  }),
}

export const practitionersResource: ApiResource = {
  table: 'team_members',
  scope: 'catalog:read',
  select: 'id, full_name, is_practitioner, is_owner, role, color, online_booking_enabled, business_hours, created_at',
  filterable: { id: 'uuid', full_name: 'string', online_booking_enabled: 'boolean', ...TIMESTAMPS },
  sortable: ['full_name', 'created_at'],
  defaultOrder: { column: 'full_name', ascending: true },
  // Practitioners only, and never a deactivated one -- a deactivated member
  // still has rows in the table but must not be offered for booking.
  baseFilters: [
    { column: 'deleted_at', op: 'is_null' },
    { column: 'is_practitioner', op: 'eq', value: true },
  ],
  serialize: (row) => ({
    id: row.id,
    full_name: row.full_name,
    role: row.role,
    is_owner: row.is_owner,
    color: row.color,
    online_booking_enabled: row.online_booking_enabled,
    // The practitioner's own weekly schedule, and the authoritative one --
    // see utils/businessHours.ts. Shaped { mon: [["09:00","13:00"], …] }.
    business_hours: row.business_hours,
    created_at: row.created_at,
  }),
}

export const clinicsResource: ApiResource = {
  table: 'clinics',
  scope: 'catalog:read',
  select: 'id, name, legal_name, address, tax_id, timezone, business_hours, slot_duration_minutes, online_booking_enabled, created_at',
  filterable: { id: 'uuid', name: 'string', online_booking_enabled: 'boolean', ...TIMESTAMPS },
  sortable: ['name', 'created_at'],
  defaultOrder: { column: 'name', ascending: true },
  serialize: (row) => ({
    id: row.id,
    name: row.name,
    legal_name: row.legal_name,
    address: row.address,
    tax_id: row.tax_id,
    // IANA name. Every timestamp the API returns is UTC ISO 8601; this is
    // what business_hours' wall-clock strings are relative to.
    timezone: row.timezone,
    business_hours: row.business_hours,
    slot_duration_minutes: row.slot_duration_minutes,
    online_booking_enabled: row.online_booking_enabled,
    created_at: row.created_at,
  }),
}

export const appointmentTypesResource: ApiResource = {
  table: 'appointment_types',
  scope: 'catalog:read',
  select:
    'id, name, duration_minutes, default_price_cents, color, stage, online_booking_enabled, online_bookable_by, online_deposit_cents, online_payment_required, online_max_days_ahead, created_at',
  filterable: { id: 'uuid', name: 'string', online_booking_enabled: 'boolean', stage: 'string', ...TIMESTAMPS },
  sortable: ['name', 'created_at', 'duration_minutes'],
  defaultOrder: { column: 'name', ascending: true },
  serialize: (row) => ({
    id: row.id,
    name: row.name,
    duration_minutes: row.duration_minutes,
    default_price_cents: row.default_price_cents,
    color: row.color,
    stage: row.stage,
    online_booking_enabled: row.online_booking_enabled,
    online_bookable_by: row.online_bookable_by,
    online_deposit_cents: row.online_deposit_cents,
    online_payment_required: row.online_payment_required,
    online_max_days_ahead: row.online_max_days_ahead,
    created_at: row.created_at,
  }),
}

export const servicesResource: ApiResource = {
  table: 'services_products',
  scope: 'catalog:read',
  select: 'id, name, price_cents, tax_rate, created_at',
  filterable: { id: 'uuid', name: 'string', ...TIMESTAMPS },
  sortable: ['name', 'created_at', 'price_cents'],
  defaultOrder: { column: 'name', ascending: true },
  serialize: (row) => ({ id: row.id, name: row.name, price_cents: row.price_cents, tax_rate: row.tax_rate, created_at: row.created_at }),
}

export const invoicesResource: ApiResource = {
  table: 'invoices',
  scope: 'billing:read',
  select: 'id, invoice_number, patient_id, appointment_id, status, total_cents, is_refund, refunds_invoice_id, created_at',
  filterable: {
    id: 'uuid',
    invoice_number: 'string',
    patient_id: 'uuid',
    appointment_id: 'uuid',
    status: 'string',
    is_refund: 'boolean',
    total_cents: 'number',
    ...TIMESTAMPS,
  },
  sortable: ['created_at', 'invoice_number', 'total_cents'],
  defaultOrder: { column: 'created_at', ascending: false },
  serialize: (row) => ({
    id: row.id,
    invoice_number: row.invoice_number,
    patient_id: row.patient_id,
    appointment_id: row.appointment_id,
    status: row.status,
    total_cents: row.total_cents,
    is_refund: row.is_refund,
    refunds_invoice_id: row.refunds_invoice_id,
    created_at: row.created_at,
  }),
}

export const paymentsResource: ApiResource = {
  table: 'payments',
  scope: 'billing:read',
  select: 'id, invoice_id, amount_cents, method, paid_at, stripe_payment_intent_id',
  filterable: { id: 'uuid', invoice_id: 'uuid', method: 'string', paid_at: 'date', amount_cents: 'number' },
  sortable: ['paid_at', 'amount_cents'],
  defaultOrder: { column: 'paid_at', ascending: false },
  serialize: (row) => ({
    id: row.id,
    invoice_id: row.invoice_id,
    amount_cents: row.amount_cents,
    method: row.method,
    paid_at: row.paid_at,
    stripe_payment_intent_id: row.stripe_payment_intent_id,
  }),
}

export const API_RESOURCES = {
  patients: patientsResource,
  appointments: appointmentsResource,
  practitioners: practitionersResource,
  clinics: clinicsResource,
  'appointment-types': appointmentTypesResource,
  services: servicesResource,
  invoices: invoicesResource,
  payments: paymentsResource,
} as const
