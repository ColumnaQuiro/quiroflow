// Reading the pages PracticeHub's own website shows a signed-in member of
// staff, for what its API does not carry: the signed original of a submitted
// form, and an invoice as the PDF the clinic handed over (further down).
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
  // Cut before each block. Whatever precedes the first one (the patient's
  // form links) has neither a PDF link nor a delete button and drops out
  // below; it is not assumed to be there, because for some patients it is not.
  for (const block of html.split(/(?=<div[^>]*class="[^"]*\bform-submission\b)/)) {
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

// --- Invoices ------------------------------------------------------------------
//
// An invoice's original is the PDF the invoice page's Print button gives:
//
//   invoicesListings.php   every invoice, newest first, as Finances > Invoices lists them
//   invoiceActions.php     ?id=<website id>&action=download&place=internal -> the PDF
//
// The listing's `invNumber` cell is `<strong>7239</strong> <div class="invoice-id
// hidden">AbCdEf12GhIj34Kl</div>`: the number printed on the invoice, then the
// website's own 16-character id for it, which nothing else hands out. A voided
// invoice prints "-" for its number, and a few print "null" for the amount.
// Shapes as the website returned them on 26 Nov 2026 (7,241 invoices in one
// 0.2 s answer).

export interface PracticeHubInvoiceListing {
  /** The number printed on the invoice ("INV-7239"), null for a voided one. */
  number: number | null
  /** The website's id for it, the only way to its PDF. */
  webId: string
  /** The invoice's day as the list prints it, YYYY-MM-DD. */
  day: string | null
  /** Null where the list prints no amount. */
  amountCents: number | null
  patient: string
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

function plainText(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "13th October, 2026" -> "2026-10-13". */
function listDay(value: unknown): string | null {
  const m = plainText(value).match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})$/)
  const month = m ? MONTHS[m[2]!.toLowerCase()] : undefined
  if (!m || !month) return null
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
}

/** The invoices in one invoicesListings.php answer, and how many there are in all. */
export function parsePracticeHubInvoiceList(answer: unknown): { rows: PracticeHubInvoiceListing[]; total: number } {
  const data = (answer ?? {}) as { aaData?: unknown; iTotalRecords?: unknown }
  const raw = Array.isArray(data.aaData) ? data.aaData : []
  const rows: PracticeHubInvoiceListing[] = []
  for (const item of raw) {
    const row = (item ?? {}) as Record<string, unknown>
    const cell = String(row.invNumber ?? '')
    const webId = cell.match(/invoice-id[^>]*>\s*([A-Za-z0-9]{8,40})\s*</)?.[1]
    if (!webId) continue
    const printed = cell.match(/<strong[^>]*>\s*(\d+)\s*<\/strong>/)?.[1]
    const amount = plainText(row.amount)
    rows.push({
      number: printed ? Number(printed) : null,
      webId,
      day: listDay(row.date),
      amountCents: /^-?\d+(\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : null,
      patient: plainText(row.patient),
    })
  }
  return { rows, total: Number(data.iTotalRecords) || rows.length }
}

/** Where one invoice's PDF is, by its website id. */
export function practiceHubInvoicePdfPath(webId: string): string {
  return `/config/scripts/invoices/invoiceActions.php?id=${encodeURIComponent(webId)}&action=download&place=internal`
}

/** The reference an invoice's original is stored under: `PH-invoice-pdf-7239` beside the invoice `PHI-7239`. */
export function practiceHubInvoicePdfReference(number: number | string): string {
  return `PH-invoice-pdf-${number}`
}

/** `PHI-7239` -> `PH-invoice-pdf-7239`; null for an invoice that did not come from PracticeHub. */
export function practiceHubInvoicePdfReferenceForInvoice(invoiceNumber: string | null | undefined): string | null {
  const n = invoiceNumber?.match(/^PHI-(\d+)$/)?.[1]
  return n ? practiceHubInvoicePdfReference(n) : null
}

function nameWords(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Whether the name PracticeHub's list prints and a patient's name here are the
 * same person's, before a PDF naming one is filed with the other. Accents,
 * case and punctuation aside, every word of the shorter must be in the longer:
 * "Maria Jose Garcia" is "María José García Pérez", "Maria Garcia" is not
 * "Mario Garcia". An empty name never matches.
 */
export function samePracticeHubPatientName(listed: string, ours: string): boolean {
  const a = nameWords(listed)
  const b = nameWords(ours)
  if (a.length === 0 || b.length === 0) return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  const pool = [...long]
  for (const word of short) {
    const i = pool.indexOf(word)
    if (i < 0) return false
    pool.splice(i, 1)
  }
  return true
}

/** An invoice the Ledger step imported, as the invoice-originals job reads it. */
export interface PracticeHubImportedInvoice {
  patient_id: string
  invoice_number: string
  total_cents: number
  created_at: string
  patients: { first_name: string | null; last_name: string | null } | null
}

/** The calendar day of an instant in a time zone, YYYY-MM-DD: an imported invoice's day as the clinic saw it. */
export function practiceHubInvoiceDay(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant))
}

/**
 * Whether the invoice PracticeHub lists is the one imported here under its
 * number. Every check that can be made is made; one PracticeHub left blank
 * (a few rows print no amount) is not counted against it.
 */
export function samePracticeHubInvoice(listed: PracticeHubInvoiceListing, ours: PracticeHubImportedInvoice, timeZone: string): boolean {
  if (listed.day && listed.day !== practiceHubInvoiceDay(ours.created_at, timeZone)) return false
  if (listed.amountCents !== null && listed.amountCents !== ours.total_cents) return false
  return samePracticeHubPatientName(listed.patient, `${ours.patients?.first_name ?? ''} ${ours.patients?.last_name ?? ''}`)
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
