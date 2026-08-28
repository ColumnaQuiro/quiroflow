export type DocFieldType =
  | 'heading'
  | 'text'
  | 'short_text'
  | 'long_text'
  | 'checkbox'
  | 'date'
  | 'signature'
  | 'choice'
  | 'scale'
  | 'rating'

export interface DocField {
  id: string
  type: DocFieldType
  label: string
  required?: boolean
  value?: string | boolean | number | string[] | null
  // 'choice' only
  options?: string[]
  multiple?: boolean
  allowOther?: boolean
}

export const FIELD_TYPES: { type: DocFieldType; label: string }[] = [
  { type: 'heading', label: 'Heading' },
  { type: 'text', label: 'Text' },
  { type: 'short_text', label: 'Short answer' },
  { type: 'long_text', label: 'Long answer' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'choice', label: 'Options' },
  { type: 'scale', label: 'Number scale' },
  { type: 'rating', label: 'Rating' },
  { type: 'date', label: 'Date' },
  { type: 'signature', label: 'Signature' },
]

// Static content blocks (heading/text) support {{field}} merge tokens in
// their label so a template can personalize wording; interactive blocks
// (short_text, checkbox...) keep label as the question prompt instead.
export const STATIC_BLOCK_TYPES: DocFieldType[] = ['heading', 'text']

export const DOC_MERGE_FIELDS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'date_of_birth', label: 'Date of birth' },
  { key: 'email', label: 'Email' },
  { key: 'clinic_name', label: 'Clinic name' },
  { key: 'today', label: "Today's date" },
]

function emptyValue(type: DocFieldType, multiple?: boolean): DocField['value'] {
  if (type === 'checkbox') return false
  if (type === 'choice') return multiple ? [] : null
  return null
}

export function newField(type: DocFieldType): DocField {
  const field: DocField = {
    id: crypto.randomUUID(),
    type,
    label: '',
    required: false,
    value: emptyValue(type),
  }
  if (type === 'choice') {
    field.options = ['Option 1', 'Option 2']
    field.multiple = false
  }
  return field
}

// Renders a template's fields for a specific patient: substitutes
// {{field}} tokens in static block labels, and resets interactive
// blocks to an empty value so the generated doc starts unfilled.
export function renderTemplateFields(fields: unknown, vars: Record<string, string>): DocField[] {
  const list = Array.isArray(fields) ? (fields as DocField[]) : []
  return list.map((f) => ({
    ...f,
    label: STATIC_BLOCK_TYPES.includes(f.type) ? f.label.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '') : f.label,
    value: emptyValue(f.type, f.multiple),
  }))
}
