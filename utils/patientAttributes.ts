// Custom patient fields (patient_attributes / patient_attribute_values,
// 20261023053614_custom_patient_fields.sql): fields each clinic adds to the
// patient's record. A value is stored as text in one form per kind -- a
// number with a dot, a date as YYYY-MM-DD, yes/no as true/false, a choice as
// the option's text -- and the database refuses any other.
import { formatLongDate } from './billing'

export const PATIENT_ATTRIBUTE_KINDS = ['text', 'long_text', 'number', 'date', 'boolean', 'choice'] as const
export type PatientAttributeKind = (typeof PATIENT_ATTRIBUTE_KINDS)[number]
export type PatientAttributeSection = 'clinical' | 'admin'

export interface PatientAttribute {
  id: string
  label: string
  key: string
  section: PatientAttributeSection
  kind: PatientAttributeKind
  options: string[]
  position: number
  archived_at: string | null
}

export const PATIENT_ATTRIBUTE_COLUMNS = 'id, label, key, section, kind, options, position, archived_at'

type T = (en: string, es: string) => string

export function patientAttributeKindLabel(kind: string, t: T): string {
  switch (kind) {
    case 'text':
      return t('Short text', 'Texto corto')
    case 'long_text':
      return t('Long text', 'Texto largo')
    case 'number':
      return t('Number', 'Número')
    case 'date':
      return t('Date', 'Fecha')
    case 'boolean':
      return t('Yes / no', 'Sí / no')
    case 'choice':
      return t('Single choice', 'Selección única')
    default:
      return kind
  }
}

/**
 * The {{attr_<key>}} merge field for a new field: its label without accents
 * or punctuation, made unique among the clinic's other keys. Kept when the
 * field is renamed, so templates written against it keep working.
 */
export function patientAttributeKeyFromLabel(label: string, taken: readonly string[]): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36) || 'campo'
  let key = base
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`
  return key
}

/**
 * Its key in accounts.new_patient_field_config, beside the standard fields'.
 * Unlike theirs, absent means hidden: a field the clinic has just made is
 * not put in front of the desk until someone says so.
 */
export function patientAttributeNewPatientKey(id: string): string {
  return `attribute:${id}`
}

export function patientAttributeMergeToken(key: string): string {
  return `attr_${key}`
}

/**
 * What the form holds, in the stored form, or null for a blank (which is no
 * row at all). A number typed with a comma, as Spain writes it, is stored
 * with a dot.
 */
export function normalizePatientAttributeValue(kind: string, raw: string | boolean | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  if (kind === 'boolean') return raw === true || raw === 'true' ? 'true' : raw === false || raw === 'false' ? 'false' : null
  const text = String(raw).trim()
  if (!text) return null
  if (kind === 'number') return text.replace(',', '.')
  return text
}

/** A stored value as the record shows it. */
export function formatPatientAttributeValue(kind: string, value: string | null | undefined, t: T): string {
  if (value === null || value === undefined || value === '') return ''
  if (kind === 'boolean') return value === 'true' ? t('Yes', 'Sí') : t('No', 'No')
  if (kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatLongDate(`${value}T12:00:00`) : value
  if (kind === 'number') return t(value, value.replace('.', ','))
  return value
}

/**
 * The merge fields a document template can use for a patient: one per field
 * with an answer, keyed {{attr_<key>}}, in the clinic's language.
 */
export function patientAttributeMergeVars(
  rows: { value: string; patient_attributes: { key: string; kind: string } | null }[],
): Record<string, string> {
  const spanish: T = (_en, es) => es
  const vars: Record<string, string> = {}
  for (const row of rows) {
    if (!row.patient_attributes) continue
    vars[patientAttributeMergeToken(row.patient_attributes.key)] = formatPatientAttributeValue(row.patient_attributes.kind, row.value, spanish)
  }
  return vars
}
