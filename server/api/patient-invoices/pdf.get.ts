import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// A patient downloading one of their own invoices as a PDF.
//
// The staff route (server/api/invoices/[id]/pdf.get.ts) is behind
// requirePermission('billing_access') and has to stay that way, so this is
// its patient-side twin rather than a loosened copy.
//
// Same shape as patient-files/signed-url.post.ts: the authorization IS the
// read below. It runs as the patient, so the invoices RLS policy decides
// whether this row exists at all -- somebody else's invoice simply returns
// nothing and 404s here. Only after that does the service-role client load
// the document, because building an invoice PDF also needs line items, the
// clinic's own details and its logo, none of which a patient can read (nor
// should be able to).
export default defineEventHandler(async (event) => {
  const invoiceId = getQuery(event).id as string | undefined
  if (!invoiceId) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const { supabase } = await requireAuthedUser(event)

  const { data: invoice } = await supabase.from('invoices').select('id').eq('id', invoiceId).maybeSingle()
  if (!invoice) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }

  const serviceSupabase = serverSupabaseServiceRole<Database>(event)
  const data = await loadInvoiceDocumentData(serviceSupabase, invoiceId)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }

  const pdf = await generateInvoicePdf(data)

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${data.invoiceNumber}.pdf"`)
  return pdf
})
