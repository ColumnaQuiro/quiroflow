export default defineEventHandler(async (event) => {
  const invoiceId = getRouterParam(event, 'id')
  const { supabase } = await requirePermission(event, 'billing_access')

  const data = await loadInvoiceDocumentData(supabase, invoiceId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }

  const [pdf] = await Promise.all([
    generateInvoicePdf(data),
    logPatientAccess(supabase, data.accountId, 'invoice_pdf', data.patientId, { invoice: data.invoiceNumber }),
  ])

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${data.invoiceNumber}.pdf"`)
  return pdf
})
