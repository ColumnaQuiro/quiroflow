import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// A patient fetching one of their own facturas, as a link they can open.
//
// The patient-side twin of server/api/facturas/[id]/pdf.get.ts, and the exact
// shape of patient-invoices/pdf-link.post.ts -- see that file for why this
// returns a URL rather than bytes (the app is a WKWebView, where a download
// attribute does nothing and a blob URL goes nowhere).
//
// The authorization IS the read below: it runs as the patient, so the facturas
// RLS policy decides whether the row exists at all. Somebody else's factura
// returns nothing and 404s. Only then does the service role build the
// document, which needs the clinic's own details and its logo -- neither of
// which a patient can read, nor should be able to.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ facturaId?: string }>(event)
  if (!body?.facturaId) {
    throw createError({ statusCode: 400, statusMessage: 'facturaId is required' })
  }

  const { supabase } = await requireAuthedUser(event)

  const { data: factura } = await supabase
    .from('facturas')
    .select('id, account_id, patient_id')
    .eq('id', body.facturaId)
    .maybeSingle()
  if (!factura) {
    throw createError({ statusCode: 404, statusMessage: 'Factura not found' })
  }

  const serviceSupabase = serverSupabaseServiceRole<Database>(event)
  const data = await loadFacturaDocumentData(serviceSupabase, factura.id)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Factura not found' })
  }

  const pdf = await generateInvoicePdf(data)
  const fileName = `${data.invoiceNumber}.pdf`
  // Regenerated and overwritten each time rather than cached: the recipient
  // block resolves from the patient record, so a NIF added after the factura
  // was issued has to reach the next download.
  const path = `${factura.account_id}/${factura.patient_id}/factura-${factura.id}.pdf`

  const { error: uploadError } = await serviceSupabase.storage
    .from('invoice-pdfs')
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (uploadError) {
    throw createError({ statusCode: 502, statusMessage: 'Could not prepare the factura' })
  }

  const { data: signed, error } = await serviceSupabase.storage
    .from('invoice-pdfs')
    .createSignedUrl(path, 60 * 5, { download: fileName })
  if (error || !signed) {
    throw createError({ statusCode: 502, statusMessage: 'Could not prepare the factura' })
  }

  return { url: signed.signedUrl, fileName }
})
