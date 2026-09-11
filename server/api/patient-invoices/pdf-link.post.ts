import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// A patient asking for one of their own invoices as a PDF, as a link they
// can open.
//
// The staff route (server/api/invoices/[id]/pdf.get.ts) is behind
// requirePermission('billing_access') and stays that way; this is its
// patient-side twin.
//
// It returns a URL rather than the bytes because of where it gets opened:
// the patient app is a WKWebView, where a download attribute does nothing
// and a blob URL in a new tab goes nowhere. A real, short-lived URL handed
// to the system viewer is the one thing that works on both ends -- it is
// already how a clinic-shared file reaches a patient, see
// patient-files/signed-url.post.ts.
//
// Same authorization shape as that route: the authorization IS the read
// below. It runs as the patient, so the invoices RLS policy decides whether
// the row exists at all -- somebody else's invoice returns nothing and
// 404s here. Only then does the service role build the document, because a
// PDF also needs line items, the clinic's own details and its logo, none of
// which a patient can read (nor should be able to).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ invoiceId?: string }>(event)
  if (!body?.invoiceId) {
    throw createError({ statusCode: 400, statusMessage: 'invoiceId is required' })
  }

  const { supabase } = await requireAuthedUser(event)

  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, account_id, patient_id')
    .eq('id', body.invoiceId)
    .maybeSingle()
  if (!invoice) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }

  const serviceSupabase = serverSupabaseServiceRole<Database>(event)
  const data = await loadInvoiceDocumentData(serviceSupabase, invoice.id)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }

  const pdf = await generateInvoicePdf(data)
  const fileName = `${data.invoiceNumber}.pdf`
  // One object per invoice, overwritten: an invoice that was corrected must
  // not keep handing out the version that was right last week.
  const path = `${invoice.account_id}/${invoice.patient_id}/${invoice.id}.pdf`

  const { error: uploadError } = await serviceSupabase.storage
    .from('invoice-pdfs')
    .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (uploadError) {
    throw createError({ statusCode: 502, statusMessage: 'Could not prepare the invoice' })
  }

  const { data: signed, error } = await serviceSupabase.storage
    .from('invoice-pdfs')
    .createSignedUrl(path, 60 * 5, { download: fileName })
  if (error || !signed) {
    throw createError({ statusCode: 502, statusMessage: 'Could not prepare the invoice' })
  }

  return { url: signed.signedUrl, fileName }
})
