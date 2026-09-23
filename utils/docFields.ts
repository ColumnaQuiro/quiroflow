export type DocFieldType =
  | 'heading'
  | 'text'
  | 'short_text'
  | 'long_text'
  | 'checkbox'
  | 'date'
  | 'signature'
  | 'drawable_image'
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
  // Links this interactive field two ways to a patient column: rendering a
  // template prefills it from the patient's existing data (renderTemplateFields
  // below), and completing the public doc writes whatever the patient typed
  // back onto that column (see save_public_patient_doc in
  // 0151_patient_doc_field_sync.sql, which re-declares this exact key list as
  // a hardcoded allowlist -- it runs unauthenticated by public token, so it
  // can never resolve a column name from client input, only match against
  // one of these known keys). Keep the two lists in sync by hand.
  patientField?: string
  // 'drawable_image' only: the object key in the public `doc-images` bucket
  // holding the diagram drawn on. A path rather than a URL, matching
  // clinics.logo_storage_path -- the project's URL is rebuilt at render time,
  // so a template written today survives the Supabase project moving.
  //
  // renderTemplateFields copies it onto every document made from the
  // template, so a diagram object is referenced by each of them for as long
  // as they exist. Nothing deletes one: replacing or removing a template's
  // diagram leaves the old object exactly where the signed documents that
  // already point at it expect to find it.
  imagePath?: string
}

// Only fields a plain text/date patient column can sensibly hold both ends
// of. Still excludes phone: patient_contact_numbers is a separate multi-row
// table with its own shape (country code, is_whatsapp), not a single column
// this can write a bare string into.
//
// first_name/last_name were excluded on the grounds that they are merge
// tokens rather than questions. That was wrong for the case this feature
// exists for -- an intake form where the patient fills in their own details
// asks for the name first, and a form that collects a name and cannot store
// it leaves reception retyping it. They are merge tokens AND questions; the
// two lists are separate (DOC_MERGE_FIELDS below) and nothing stops a key
// appearing in both.
export const LINKABLE_PATIENT_FIELDS = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'date_of_birth', label: 'Date of birth' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'postal_code', label: 'Postal code' },
  { key: 'country', label: 'Country' },
  { key: 'national_id', label: 'National ID' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'gender', label: 'Gender' },
  { key: 'emergency_contact', label: 'Emergency contact' },
]

// Field types a patient-column link makes sense for -- a plain text/date
// answer, not a checkbox/choice/scale/rating/signature.
export const LINKABLE_FIELD_TYPES: DocFieldType[] = ['short_text', 'long_text', 'date']

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
  { type: 'drawable_image', label: 'Drawable image' },
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
// {{field}} tokens in static block labels, and resets interactive blocks to
// an empty value -- except one linked to a patient field (see
// DocField.patientField) whose data already exists, which starts prefilled
// with it instead so the patient isn't asked for something already on file.
export function renderTemplateFields(fields: unknown, vars: Record<string, string>): DocField[] {
  const list = Array.isArray(fields) ? (fields as DocField[]) : []
  return list.map((f) => {
    const known = f.patientField ? vars[f.patientField] : undefined
    return {
      ...f,
      label: STATIC_BLOCK_TYPES.includes(f.type) ? f.label.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '') : f.label,
      value: known ? known : emptyValue(f.type, f.multiple),
    }
  })
}
