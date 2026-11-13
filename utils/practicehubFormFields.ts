import { patientFieldForQuestion, type DocField } from './docFields'

// Turns one PracticeHub form response into the blocks of a document here.
//
// PracticeHub's API returns a response as flat {name, value, label} rows with
// no type. The type is in the name the form builder gave the field
// ("radio-group-1602421484765", "signature-signature-…"), so that is what
// this reads.
//
// Three things about those rows are not guessable and were each got wrong:
//
// - A ticked checkbox arrives as one row PER TICKED OPTION, all with the same
//   name ending in "[]", the option's text in `value`. Each row used to become
//   its own checkbox holding `true` under the question's label, so "Which
//   other specialists have you seen?" imported as six identical ticked boxes
//   and the answers themselves were gone.
// - A block of fixed text (a legal paragraph, an instruction) has a name that
//   is only digits. It was told apart from an answer by being long, so a short
//   one imported as a question called "Answer" with the paragraph as its reply.
// - A signature or a drawing arrives as the widget's own id and nothing else.
//   The image is not in the API at all, only in the PDF PracticeHub's website
//   renders for a signed-in user. They were imported as a line of text saying
//   so, which left a template nobody could sign: the block is the type the
//   field was, a signature or a drawable image, empty. On a filled-in form
//   the label says where the signature is; the Signed forms step files that
//   PDF with the form.

export interface PracticeHubFormField {
  name: string
  value: string | null
  label: string | null
  help_text?: string | null
}

function stripHtml(value: string): string {
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
}

function isOptionRow(field: PracticeHubFormField): boolean {
  return field.name.endsWith('[]')
}

/** A question with one answer picked from a list: PracticeHub's radio group or dropdown. */
function isSingleChoice(field: PracticeHubFormField): boolean {
  return /^(radio-group|select)-/i.test(field.name)
}

/**
 * Every option seen chosen for each checkbox, radio or dropdown question, across all the
 * responses to one form, in first-seen order. A single response only names
 * the options that patient ticked; together they are as close to the
 * question's full list as the API gets.
 */
export function practiceHubFormOptions(responses: { data: PracticeHubFormField[] | null }[]): Map<string, string[]> {
  const options = new Map<string, string[]>()
  for (const response of responses) {
    for (const field of response.data ?? []) {
      if (!isOptionRow(field) && !isSingleChoice(field)) continue
      const text = stripHtml(field.value ?? '')
      if (!text) continue
      const seen = options.get(field.name) ?? []
      if (!seen.includes(text)) seen.push(text)
      options.set(field.name, seen)
    }
  }
  return options
}

/**
 * The document blocks for one response. `blank` gives the template's copy:
 * the same questions with no answers, for sending to a patient who never
 * filled the form in.
 */
export function practiceHubFormBlocks(
  data: PracticeHubFormField[] | null,
  opts: { blank?: boolean; options?: Map<string, string[]>; newId?: () => string } = {},
): DocField[] {
  const blank = opts.blank ?? false
  const newId = opts.newId ?? (() => crypto.randomUUID())
  const blocks: DocField[] = []
  const rows = data ?? []

  for (let i = 0; i < rows.length; i++) {
    const f = rows[i]!
    const key = f.name.toLowerCase()
    const text = stripHtml(f.value ?? '')
    const label = stripHtml(f.label ?? '')

    if (isOptionRow(f)) {
      // Gather the run of rows that are this one question's ticked options.
      const ticked: string[] = []
      let j = i
      for (; j < rows.length && rows[j]!.name === f.name; j++) {
        const option = stripHtml(rows[j]!.value ?? '')
        if (option && !ticked.includes(option)) ticked.push(option)
      }
      i = j - 1
      const known = opts.options?.get(f.name) ?? []
      blocks.push({
        id: newId(),
        type: 'choice',
        label: label || 'Options',
        multiple: true,
        options: [...known, ...ticked.filter((option) => !known.includes(option))],
        value: blank ? [] : ticked,
      })
      continue
    }

    if (isSingleChoice(f)) {
      const known = opts.options?.get(f.name) ?? []
      blocks.push({
        id: newId(),
        type: 'choice',
        label: label || 'Options',
        multiple: false,
        options: text && !known.includes(text) ? [...known, text] : known,
        value: blank ? null : text || null,
      })
      continue
    }

    if (key.includes('signature')) {
      blocks.push({ id: newId(), type: 'signature', label: blank ? label || 'Signature' : `${label || 'Signature'} (signed in PracticeHub)`, value: null })
    } else if (key.includes('sketchpad') || key.includes('drawableimage') || key.includes('image')) {
      blocks.push({ id: newId(), type: 'drawable_image', label: blank ? label || 'Diagram' : `${label || 'Diagram'} (drawn in PracticeHub)`, value: null })
    } else if (/^\d+$/.test(f.name) || (!label && text.length > 120)) {
      // Fixed text the form shows, not something the patient answered.
      if (text) blocks.push({ id: newId(), type: 'text', label: text, value: null })
    } else if (key.includes('date')) {
      blocks.push({ id: newId(), type: 'date', label: label || 'Date', value: blank ? null : f.value || null })
    } else if (key.includes('checkbox')) {
      blocks.push({ id: newId(), type: 'checkbox', label: label || text || 'Consent', value: blank ? false : !!f.value })
    } else {
      // A question about the patient's own details is linked to that column,
      // so the template keeps filling the profile and the import can fill it
      // from the answer (see patientFieldForQuestion).
      const patientField = patientFieldForQuestion(label)
      blocks.push({
        id: newId(),
        type: text.length > 80 ? 'long_text' : 'short_text',
        label: label || 'Answer',
        value: blank ? null : text || null,
        ...(patientField ? { patientField } : {}),
      })
    }
  }
  return blocks
}
