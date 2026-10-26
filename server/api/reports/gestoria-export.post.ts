import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { createZip, toCsv, type ZipEntry } from '~/server/utils/zipStore'
import { loadFacturaDocumentData } from '~/server/utils/facturaData'
import { generateInvoicePdf } from '~/server/utils/invoiceData'
import { mapWithConcurrency } from '~/server/utils/concurrency'
import { DEFAULT_CLINIC_TIMEZONE, nextDate, startOfLocalDate } from '~/utils/clinicClock'
import { eurPlain, facturaBookRows, ivaSummary, ivaSummaryRows, paymentsByMethod, type GestoriaFactura, type GestoriaPayment } from '~/utils/gestoriaExport'

// Reports > Gestoría: a period's facturas for the clinic's accountant
// (utils/gestoriaExport.ts). { from, to } as YYYY-MM-DD on the clinic's clock.
//   preview: true   the IVA summary and the money by method, for the page
//   otherwise       a ZIP -- the libro registro de facturas expedidas, the
//                   IVA summary and the payments -- stored privately and
//                   handed back as a link valid for an hour, as the GDPR
//                   export is: a function answers at most ~6 MB.
//   pdfPart: n      instead, a ZIP of the facturas' PDFs, the n-th group
//                   of PDF_PART (0-based). A PDF takes ~85 ms to make, and
//                   a function has ~10 s, so a period's PDFs come in parts.
// Billing and reports access both, as the income reports and the facturas
// themselves need.
const LINK_SECONDS = 3600
const KEEP_HOURS = 24
/** PDFs per part: comfortably inside a function's time. */
const PDF_PART = 80

export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requireAllPermissions(event, ['reports_access', 'billing_access'])
  const body = await readBody<{ from?: string; to?: string; pdfPart?: number; preview?: boolean }>(event)
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (!body?.from || !body.to || !iso.test(body.from) || !iso.test(body.to) || body.to < body.from) {
    throw createError({ statusCode: 400, statusMessage: 'from and to are required (YYYY-MM-DD)' })
  }
  const accountId = teamMember.account_id

  const { data: clinic } = await supabase.from('clinics').select('timezone').is('archived_at', null).order('created_at').limit(1).maybeSingle()
  const tz = clinic?.timezone || DEFAULT_CLINIC_TIMEZONE
  const start = startOfLocalDate(body.from, tz).toISOString()
  const end = startOfLocalDate(nextDate(body.to), tz).toISOString()

  // Every factura of the period, a page at a time (PostgREST answers 1,000).
  type Row = { id: string; number: string; kind: string; issued_at: string; description: string | null; amount_cents: number; tax_base_cents: number | null; tax_rate_bp: number | null; tax_amount_cents: number | null; tax_exemption_code: string | null; recipient_name: string | null; recipient_nif: string | null; rectifies_factura_id: string | null; payment_id: string | null; annulled_at: string | null }
  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('facturas')
      .select('id, number, kind, issued_at, description, amount_cents, tax_base_cents, tax_rate_bp, tax_amount_cents, tax_exemption_code, recipient_name, recipient_nif, rectifies_factura_id, payment_id, annulled_at')
      .eq('account_id', accountId)
      .gte('issued_at', start)
      .lt('issued_at', end)
      .order('issued_at')
      .range(from, from + 999)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    rows.push(...((data as Row[] | null) ?? []))
    if (!data || data.length < 1000) break
  }

  // What each rectificativa corrects, and how each was paid.
  const numberOf = new Map(rows.map((r) => [r.id, r.number]))
  const missing = [...new Set(rows.map((r) => r.rectifies_factura_id).filter((id): id is string => !!id && !numberOf.has(id)))]
  if (missing.length) {
    const { data } = await supabase.from('facturas').select('id, number').in('id', missing)
    for (const r of data ?? []) numberOf.set(r.id, r.number)
  }
  const methodOf = new Map<string, string>()
  const paymentIds = rows.map((r) => r.payment_id).filter((id): id is string => !!id)
  for (let i = 0; i < paymentIds.length; i += 200) {
    const { data } = await supabase.from('payments').select('id, method').in('id', paymentIds.slice(i, i + 200))
    for (const p of data ?? []) methodOf.set(p.id, p.method)
  }
  const facturas: (GestoriaFactura & { id: string })[] = rows.map((r) => ({
    ...r,
    rectifies_number: r.rectifies_factura_id ? (numberOf.get(r.rectifies_factura_id) ?? null) : null,
    payment_method: r.payment_id ? (methodOf.get(r.payment_id) ?? null) : null,
  }))

  // Money in during the period, by method.
  const payments: GestoriaPayment[] = []
  const facturaOfPayment = new Map(rows.filter((r) => r.payment_id).map((r) => [r.payment_id!, r.number]))
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('payments').select('id, paid_at, amount_cents, method').eq('account_id', accountId).gte('paid_at', start).lt('paid_at', end).order('paid_at').range(from, from + 999)
    if (error) throw createError({ statusCode: 500, statusMessage: error.message })
    for (const p of data ?? []) payments.push({ paid_at: p.paid_at, amount_cents: p.amount_cents, method: p.method, factura_number: facturaOfPayment.get(p.id) ?? null })
    if (!data || data.length < 1000) break
  }

  if (body.preview) {
    return { count: facturas.length, iva: ivaSummary(facturas), byMethod: paymentsByMethod(payments), pdfParts: Math.ceil(facturas.length / PDF_PART) }
  }

  const part = typeof body.pdfPart === 'number' && Number.isInteger(body.pdfPart) && body.pdfPart >= 0 ? body.pdfPart : null
  const entries: ZipEntry[] = part !== null ? [] : [
    { name: 'libro-facturas-expedidas.csv', data: toCsv(facturaBookRows(facturas, tz)) },
    { name: 'resumen-iva.csv', data: toCsv(ivaSummaryRows(facturas)) },
    {
      name: 'cobros.csv',
      data: toCsv(payments.filter((p) => p.method !== 'credit').map((p) => ({
        Fecha: new Date(p.paid_at).toLocaleDateString('es-ES', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }),
        Importe: eurPlain(p.amount_cents),
        'Forma de pago': p.method,
        Factura: p.factura_number ?? '',
      }))),
    },
  ]
  if (part !== null) {
    const slice = facturas.slice(part * PDF_PART, (part + 1) * PDF_PART)
    if (!slice.length) throw createError({ statusCode: 400, statusMessage: 'No such part' })
    const pdfs = await mapWithConcurrency(slice, 6, async (f) => {
      const data = await loadFacturaDocumentData(supabase, f.id)
      return data ? { name: `facturas/${f.number}.pdf`, data: new Uint8Array(await generateInvoicePdf(data)) } : null
    })
    for (const p of pdfs) if (p) entries.push(p)
  }
  const zip = createZip(entries)

  const service = serverSupabaseServiceRole<Database>(event)
  const folder = `${accountId}/exports`
  const { data: old } = await service.storage.from('patient-files').list(folder, { limit: 100 })
  const stale = (old ?? []).filter((f) => f.created_at && Date.now() - Date.parse(f.created_at) > KEEP_HOURS * 3_600_000).map((f) => `${folder}/${f.name}`)
  if (stale.length) await service.storage.from('patient-files').remove(stale)
  const fileName = part !== null ? `gestoria-${body.from}-a-${body.to}-pdf-${part + 1}.zip` : `gestoria-${body.from}-a-${body.to}.zip`
  const path = `${folder}/${Date.now()}-${fileName}`
  const { error: uploadError } = await service.storage.from('patient-files').upload(path, zip, { contentType: 'application/zip' })
  if (uploadError) throw createError({ statusCode: 500, statusMessage: 'Could not store the export.' })
  const { data: signed } = await service.storage.from('patient-files').createSignedUrl(path, LINK_SECONDS, { download: fileName })
  if (!signed?.signedUrl) throw createError({ statusCode: 500, statusMessage: 'Could not create the download link.' })
  return { url: signed.signedUrl, fileName, count: facturas.length, expiresInSeconds: LINK_SECONDS }
})
