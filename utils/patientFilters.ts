// The patient list's filters, in the three shapes they take:
//
//  - PatientFilterForm: what the toolbar binds to. Every key present, '' or
//    false meaning "not filtering", because a <select> v-model wants a string.
//  - PatientFilters: only the keys that filter, with status left out when it
//    is the default 'active'. This is what goes to patients_matching
//    (20261022173310_patient_segments.sql), what a segment saves, and what
//    two filter sets are compared as.
//  - the URL query: the same keys as strings, so a link to the list -- a
//    segment's included -- opens on the same patients.
//
// A key added here is a key patients_matching has to understand; unknown
// keys are ignored there, so the two can be deployed in either order.
// Custom patient attributes would join as one more key.

export interface PatientFilters {
  status?: 'inactive' | 'any'
  q?: string
  tags?: string[]
  practitioner?: string
  clinic?: string
  lastVisitFrom?: string
  lastVisitTo?: string
  futureAppointment?: 'yes' | 'no'
  bono?: 'active' | 'none'
  bonoSessionsMax?: number
  balance?: 'owing' | 'credit'
  createdFrom?: string
  createdTo?: string
  app?: 'yes' | 'no'
  birthdayThisMonth?: true
  carePlan?: 'on'
  missingContact?: 'email' | 'phone'
  doNotContact?: true
  minors?: true
}

export interface PatientFilterForm {
  status: 'active' | 'inactive' | 'any'
  q: string
  tags: string[]
  practitioner: string
  clinic: string
  lastVisitFrom: string
  lastVisitTo: string
  futureAppointment: '' | 'yes' | 'no'
  bono: '' | 'active' | 'none'
  bonoSessionsMax: string
  balance: '' | 'owing' | 'credit'
  createdFrom: string
  createdTo: string
  app: '' | 'yes' | 'no'
  birthdayThisMonth: boolean
  carePlan: '' | 'on'
  missingContact: '' | 'email' | 'phone'
  doNotContact: boolean
  minors: boolean
}

export function emptyFilterForm(): PatientFilterForm {
  return {
    status: 'active',
    q: '',
    tags: [],
    practitioner: '',
    clinic: '',
    lastVisitFrom: '',
    lastVisitTo: '',
    futureAppointment: '',
    bono: '',
    bonoSessionsMax: '',
    balance: '',
    createdFrom: '',
    createdTo: '',
    app: '',
    birthdayThisMonth: false,
    carePlan: '',
    missingContact: '',
    doNotContact: false,
    minors: false,
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}
function date(value: unknown): string | undefined {
  return typeof value === 'string' && DATE.test(value) ? value : undefined
}
function uuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value) ? value : undefined
}
function truthy(value: unknown): true | undefined {
  return value === true || value === 'true' || value === '1' ? true : undefined
}

/**
 * Only what filters, in a fixed key order, with anything malformed dropped --
 * a hand-edited URL or a segment saved by another version cannot send the
 * database a date it cannot cast.
 */
export function normalizeFilters(input: Record<string, unknown>): PatientFilters {
  const out: PatientFilters = {}
  const status = oneOf(input.status, ['inactive', 'any'] as const)
  if (status) out.status = status
  const q = typeof input.q === 'string' ? input.q.trim() : ''
  if (q) out.q = q
  const rawTags = Array.isArray(input.tags) ? input.tags : typeof input.tags === 'string' ? input.tags.split(',') : []
  const tags = [...new Set(rawTags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean))].sort()
  if (tags.length) out.tags = tags
  const practitioner = uuid(input.practitioner)
  if (practitioner) out.practitioner = practitioner
  const clinic = input.clinic === 'all' ? 'all' : uuid(input.clinic)
  if (clinic) out.clinic = clinic
  const lastVisitFrom = date(input.lastVisitFrom)
  if (lastVisitFrom) out.lastVisitFrom = lastVisitFrom
  const lastVisitTo = date(input.lastVisitTo)
  if (lastVisitTo) out.lastVisitTo = lastVisitTo
  const futureAppointment = oneOf(input.futureAppointment, ['yes', 'no'] as const)
  if (futureAppointment) out.futureAppointment = futureAppointment
  const bono = oneOf(input.bono, ['active', 'none'] as const)
  if (bono) out.bono = bono
  // Only meaningful with a live bono: "none left" is bono=none.
  const max = typeof input.bonoSessionsMax === 'number' ? input.bonoSessionsMax : Number.parseInt(String(input.bonoSessionsMax ?? ''), 10)
  if (bono === 'active' && Number.isInteger(max) && max >= 0) out.bonoSessionsMax = max
  const balance = oneOf(input.balance, ['owing', 'credit'] as const)
  if (balance) out.balance = balance
  const createdFrom = date(input.createdFrom)
  if (createdFrom) out.createdFrom = createdFrom
  const createdTo = date(input.createdTo)
  if (createdTo) out.createdTo = createdTo
  const app = oneOf(input.app, ['yes', 'no'] as const)
  if (app) out.app = app
  if (truthy(input.birthdayThisMonth)) out.birthdayThisMonth = true
  if (oneOf(input.carePlan, ['on'] as const)) out.carePlan = 'on'
  const missingContact = oneOf(input.missingContact, ['email', 'phone'] as const)
  if (missingContact) out.missingContact = missingContact
  if (truthy(input.doNotContact)) out.doNotContact = true
  if (truthy(input.minors)) out.minors = true
  return out
}

export function formToFilters(form: PatientFilterForm): PatientFilters {
  return normalizeFilters({ ...form })
}

export function filtersToForm(filters: PatientFilters): PatientFilterForm {
  const f = normalizeFilters({ ...filters })
  return {
    ...emptyFilterForm(),
    ...f,
    status: f.status ?? 'active',
    tags: f.tags ?? [],
    bonoSessionsMax: f.bonoSessionsMax === undefined ? '' : String(f.bonoSessionsMax),
    birthdayThisMonth: !!f.birthdayThisMonth,
    doNotContact: !!f.doNotContact,
    minors: !!f.minors,
  }
}

/** The query string for a set of filters: tags comma-joined, flags as 1. */
export function filtersToQuery(filters: PatientFilters): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(normalizeFilters({ ...filters }))) {
    if (Array.isArray(value)) out[key] = value.join(',')
    else if (value === true) out[key] = '1'
    else out[key] = String(value)
  }
  return out
}

export function filtersFromQuery(query: Record<string, unknown>): PatientFilters {
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(query)) flat[key] = Array.isArray(value) ? value[0] : value
  return normalizeFilters(flat)
}

/** Whether the query names any filter at all (a bare ?segment= does not). */
export function queryHasFilters(query: Record<string, unknown>): boolean {
  return Object.keys(filtersFromQuery(query)).length > 0
}

export function sameFilters(a: PatientFilters, b: PatientFilters): boolean {
  return JSON.stringify(normalizeFilters({ ...a })) === JSON.stringify(normalizeFilters({ ...b }))
}

/** The keys edited in the "More filters" panel rather than on the toolbar. */
export const MORE_FILTER_KEYS: (keyof PatientFilters)[] = [
  'tags',
  'clinic',
  'lastVisitFrom',
  'lastVisitTo',
  'futureAppointment',
  'bono',
  'bonoSessionsMax',
  'createdFrom',
  'createdTo',
  'app',
  'birthdayThisMonth',
]
