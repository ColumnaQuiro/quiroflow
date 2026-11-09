// Each person's papers (staff_documents): nóminas, contracts, certificates,
// partes de baja. Owners upload; the person reads their own except a parte
// de baja, which is health data and stays with owners.

export const STAFF_DOCUMENT_CATEGORIES = ['payslip', 'contract', 'certificate', 'sick_note', 'other'] as const
export type StaffDocumentCategory = (typeof STAFF_DOCUMENT_CATEGORIES)[number]

export const STAFF_DOCUMENTS_BUCKET = 'team-member-files'

/** What the bucket accepts (its allowed_mime_types). */
export const STAFF_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
export const STAFF_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

/** Unopened this long, a document shows under "Waiting for you" on Personal. */
export const STAFF_DOCUMENT_UNOPENED_DAYS = 30

export interface StaffDocument {
  id: string
  team_member_id: string
  category: StaffDocumentCategory | string
  period: string | null
  title: string | null
  storage_path: string
  file_name: string
  size_bytes: number | null
  uploaded_at: string
  first_viewed_at: string | null
}

type T = (en: string, es: string) => string

export function staffDocumentCategoryLabel(category: string, t: T): string {
  if (category === 'payslip') return t('Payslip', 'Nómina')
  if (category === 'contract') return t('Contract', 'Contrato')
  if (category === 'certificate') return t('Certificate', 'Certificado')
  if (category === 'sick_note') return t('Sick note', 'Parte de baja')
  return t('Other', 'Otro')
}

/** The person cannot see a parte de baja, so it never counts as unopened. */
export const visibleToPerson = (d: Pick<StaffDocument, 'category'>) => d.category !== 'sick_note'

/** `<account>/<team member>/<random>.<ext>`, the shape the bucket's policies read. */
export function staffDocumentPath(accountId: string, teamMemberId: string, fileName: string, random: string): string {
  const ext = (fileName.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? 'pdf').toLowerCase()
  return `${accountId}/${teamMemberId}/${random}.${ext}`
}

/** "2026-10-01" → "octubre de 2026", for a payslip's month. */
export function staffDocumentPeriodLabel(period: string, locale: string): string {
  return new Date(`${period.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** How a document is called in a list: its title, else its category and month. */
export function staffDocumentName(d: Pick<StaffDocument, 'category' | 'period' | 'title'>, t: T, locale: string): string {
  if (d.title?.trim()) return d.title.trim()
  const kind = staffDocumentCategoryLabel(d.category, t)
  return d.period ? `${kind} · ${staffDocumentPeriodLabel(d.period, locale)}` : kind
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Who a file is probably for, from its name: the person whose every name
 * part appears in it ("nomina_lucia_fisio_oct.pdf" → Lucía Fisio). Only a
 * single match counts -- two people who both fit is a guess, so nobody is
 * picked and the owner chooses.
 */
export function guessStaffMember<M extends { id: string; full_name: string }>(fileName: string, members: M[]): M | null {
  const name = fold(fileName).replace(/[^a-z0-9]+/g, ' ')
  const words = new Set(name.split(' ').filter(Boolean))
  const fits = members.filter((m) => {
    const parts = fold(m.full_name).split(/[^a-z0-9]+/).filter((p) => p.length > 1)
    return parts.length > 0 && parts.every((p) => words.has(p))
  })
  if (fits.length === 1) return fits[0]!
  // Failing every part, the first name and first surname together.
  const loose = members.filter((m) => {
    const parts = fold(m.full_name).split(/[^a-z0-9]+/).filter((p) => p.length > 1)
    return parts.length >= 2 && words.has(parts[0]!) && words.has(parts[1]!)
  })
  return loose.length === 1 ? loose[0]! : null
}
