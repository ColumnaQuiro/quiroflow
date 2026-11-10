// Reading the pages PracticeHub's own website shows a signed-in member of
// staff, for the one thing its API does not carry: the signed original of a
// submitted form.
//
// A form response from the API has a signature or a drawing only as the
// widget's own id ("signature-signature-1602515975456"). The image exists
// solely in the PDF the website renders at
// /config/scripts/pdf_downloads/custom_form.php, and that page answers only
// inside a session. So the importer signs in as the clinic and reads three
// things, all of them GETs that only show something:
//
//   patientsList.php       every patient's website id, in one answer
//   get_patient/files.php  one patient's submitted forms, as an HTML fragment
//   custom_form.php        one form, as a PDF
//
// Shapes as the website returned them on 10 Nov 2026. Nothing here signs in
// or fetches: see server/utils/practicehubWeb.ts.

/** What /config/scripts/users/login.php answers, reduced to what happens next. */
export type PracticeHubLoginOutcome =
  | { state: 'in' }
  /** A code is wanted: from an authenticator app, or one PracticeHub just sent by email (or SMS). */
  | { state: 'code'; method: 'app' | 'email'; phone: string | null }
  | { state: 'refused'; message: string }
  /** PracticeHub is rate-limiting sign-ins; its own page reloads and asks again. */
  | { state: 'wait' }

export function practiceHubLoginOutcome(answer: unknown): PracticeHubLoginOutcome {
  const data = (answer ?? {}) as Record<string, unknown>
  if (data.refresh === true) return { state: 'wait' }
  if (data.step === 'enter') return { state: 'in' }
  if (data.step === 'show_two_step_auth') {
    return {
      state: 'code',
      method: data.auth_type === 'google' ? 'app' : 'email',
      phone: data.phone_available && typeof data.phone_obfuscated === 'string' ? data.phone_obfuscated : null,
    }
  }
  const message = typeof data.message === 'string' ? data.message.replace(/<[^>]+>/g, '').trim() : ''
  return { state: 'refused', message: message || 'PracticeHub did not accept that email and password.' }
}

/**
 * The website's own id for every patient in a patientsList.php answer. It is
 * not the API's id or its hashed_id: a 16-character token that only this list
 * hands out, hidden in each row's name cell.
 */
export function parsePracticeHubPatientIds(answer: unknown): { ids: string[]; total: number } {
  const data = (answer ?? {}) as { aaData?: unknown; iTotalRecords?: unknown }
  const rows = Array.isArray(data.aaData) ? data.aaData : []
  const ids: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const name = String((row as { name?: unknown } | null)?.name ?? '')
    const id = name.match(/patient-id[^>]*>\s*([A-Za-z0-9]{8,40})\s*</)?.[1]
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return { ids, total: Number(data.iTotalRecords) || ids.length }
}

export interface PracticeHubFormSubmission {
  /** The response's id, the same one the API's /custom_form_responses gives. */
  responseId: string
  /** Path and query of the form's PDF on the clinic's PracticeHub. */
  pdfPath: string
}

const PDF_PATH = '/config/scripts/pdf_downloads/custom_form.php'

/**
 * The submitted forms in one patient's files.php answer. Each is a
 * `.form-submission` block holding a link to its PDF and a delete button
 * whose data-id is the response id; the link's own ids are hashes that
 * appear nowhere else, which is why every patient has to be asked.
 *
 * Only a link to the PDF page itself is kept, as a path: whatever else the
 * fragment may link to is never followed.
 */
export function parsePracticeHubFormSubmissions(answer: unknown): PracticeHubFormSubmission[] {
  const html = String((answer as { forms?: unknown } | null)?.forms ?? '')
  const found: PracticeHubFormSubmission[] = []
  const seen = new Set<string>()
  for (const block of html.split(/(?=<div[^>]*class="[^"]*\bform-submission\b)/).slice(1)) {
    const href = block.match(/href="([^"]*custom_form\.php\?[^"]*)"/)?.[1]?.replace(/&amp;/g, '&')
    const responseId =
      block.match(/delete-form-response[^>]*\bdata-id="(\d+)"/)?.[1] ?? block.match(/\bdata-id="(\d+)"[^>]*delete-form-response/)?.[1]
    if (!href || !responseId || seen.has(responseId)) continue
    let url: URL
    try {
      url = new URL(href, 'https://practicehub.invalid')
    } catch {
      continue
    }
    if (url.pathname !== PDF_PATH) continue
    seen.add(responseId)
    found.push({ responseId, pdfPath: `${url.pathname}${url.search}` })
  }
  return found
}

/** Whether bytes PracticeHub answered with are a PDF, not its sign-in page. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/** The reference a signed original is stored under, beside its document's `PH-form-<id>`. */
export function practiceHubFormPdfReference(responseId: string | number): string {
  return `PH-form-pdf-${responseId}`
}

/** `PH-form-12` -> `PH-form-pdf-12`; null for a document that did not come from PracticeHub. */
export function practiceHubFormPdfReferenceForDoc(docReference: string | null | undefined): string | null {
  const id = docReference?.match(/^PH-form-(\d+)$/)?.[1]
  return id ? practiceHubFormPdfReference(id) : null
}
