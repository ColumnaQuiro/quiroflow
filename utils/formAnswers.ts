import type { DocField } from './docFields'

// The answers a patient gave on a completed form, as lines a practitioner
// can read beside the note and bring into it: "Where does it hurt: Lower
// back". A practitioner was retyping the intake form into their notes by
// hand (PracticeHub community, Aug 2026).
//
// Left out: the blocks that are not answers (headings, text, signatures,
// drawn images), anything unanswered, and fields linked to a patient column
// (name, email, DNI, address...) -- those are already on the record and are
// not clinical history.

export interface FormAnswer {
  label: string
  text: string
}

const NOT_ANSWERS = new Set(['heading', 'text', 'signature', 'drawable_image'])

export function formAnswers(fields: unknown, t: (en: string, es: string) => string): FormAnswer[] {
  const list = Array.isArray(fields) ? (fields as DocField[]) : []
  const out: FormAnswer[] = []
  for (const f of list) {
    if (!f || NOT_ANSWERS.has(f.type) || f.patientField) continue
    const label = (f.label ?? '').trim()
    const v = f.value
    let text = ''
    if (f.type === 'checkbox') text = v === true ? t('Yes', 'Sí') : ''
    else if (Array.isArray(v)) text = v.filter((x) => typeof x === 'string' && x.trim()).join(', ')
    else if (f.type === 'scale' && typeof v === 'number') text = `${v}/10`
    else if (f.type === 'rating' && typeof v === 'number') text = `${v}/5`
    else if (v !== null && v !== undefined) text = String(v).trim()
    if (!text || !label) continue
    out.push({ label, text })
  }
  return out
}

/** One answer as the line it becomes in the note. */
export function answerLine(a: FormAnswer): string {
  return `${a.label}: ${a.text}`
}
