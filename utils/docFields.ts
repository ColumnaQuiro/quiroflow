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
  //
  // Only the STORED document's link counts: the public link sends answers,
  // and since 20261003134945 the function keeps the stored blocks (labels,
  // types, this link) and takes nothing but each block's `value` from the
  // caller. An email answer only fills a blank patients.email, never
  // replaces one.
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

// The patient column a question imported from another system should be
// linked to, read from its wording. A form built here is linked by hand in
// Settings > Docs; an imported one arrives with no links at all, so its
// "DNI" question filled nothing -- 755 imported intake forms holding 519
// patients' DNI, and not one on a profile (13 Nov 2026).
//
// Only the patient's OWN identity document, and only a short label that is
// the question itself. "DNI Madre/Padre/Tutor legal" sits on the same intake
// form and is somebody else's number; a legal paragraph mentioning "documento
// oficial que lo identifique" is not a question at all.
const OWN_ID_QUESTION = /\b(dni|nie|nif|pasaporte|passport|documento de identidad|numero de identidad|national id|id number|carte d'identite)\b/
const SOMEONE_ELSES = /\b(madre|padre|tutor|tutora|tutores|representante|responsable|progenitor|parent|parents|guardian|mother|father|pere|mere|tuteur|representant|empresa|company|entreprise)\b/

export function patientFieldForQuestion(label: string | null | undefined): string | undefined {
  const text = (label ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  if (!text || text.length > 60) return undefined
  if (OWN_ID_QUESTION.test(text) && !SOMEONE_ELSES.test(text)) return 'national_id'
  return undefined
}

// An answer worth putting on patients.national_id: the same test
// save_public_patient_doc applies when a patient completes a form here, so
// an imported answer and a typed one are held to one rule.
export function nationalIdAnswer(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9 .-]{3,19}$/.test(text) ? text : null
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

// Letters (Settings > Letters, patient_letters) use the same {{key}} tokens,
// with the keys above meaning the same thing, plus what a letter about a
// patient needs and a form never did. `clinical` ones are left blank for
// anyone without visit_notes_access, as the record hides them
// (server/utils/letterData.ts fills them in).
export const LETTER_MERGE_FIELDS: { key: string; en: string; es: string; clinical?: boolean }[] = [
  { key: 'full_name', en: 'Patient name', es: 'Nombre del paciente' },
  { key: 'first_name', en: 'First name', es: 'Nombre' },
  { key: 'last_name', en: 'Last name', es: 'Apellidos' },
  { key: 'national_id', en: 'DNI / NIE', es: 'DNI / NIE' },
  { key: 'date_of_birth', en: 'Date of birth', es: 'Fecha de nacimiento' },
  { key: 'address', en: 'Patient address', es: 'Dirección del paciente' },
  { key: 'today', en: "Today's date", es: 'Fecha de hoy' },
  { key: 'clinic_name', en: 'Clinic name', es: 'Nombre de la clínica' },
  { key: 'clinic_tax_id', en: 'Clinic NIF', es: 'NIF de la clínica' },
  { key: 'clinic_address', en: 'Clinic address', es: 'Dirección de la clínica' },
  { key: 'practitioner_name', en: 'Practitioner', es: 'Profesional' },
  { key: 'last_visit_date', en: 'Last visit', es: 'Última visita' },
  { key: 'visit_count', en: 'Number of visits', es: 'Número de visitas' },
  { key: 'chief_complaint', en: 'Chief complaint', es: 'Motivo de consulta', clinical: true },
  { key: 'diagnosis', en: 'Diagnosis', es: 'Diagnóstico', clinical: true },
]

const MERGE_TOKEN = /\{\{(\w+)\}\}/g

// Replaces each {{key}} with its value; an unknown key becomes ''. `escape`
// is applied to each value, for a token inside HTML.
export function fillMergeTokens(text: string, vars: Record<string, string>, escape: (value: string) => string = (v) => v): string {
  return text.replace(MERGE_TOKEN, (_, k: string) => escape(vars[k] ?? ''))
}

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
      label: STATIC_BLOCK_TYPES.includes(f.type) ? fillMergeTokens(f.label, vars) : f.label,
      value: known ? known : emptyValue(f.type, f.multiple),
    }
  })
}
