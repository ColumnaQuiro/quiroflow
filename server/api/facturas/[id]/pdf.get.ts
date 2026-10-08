export default defineEventHandler(async (event) => {
  const facturaId = getRouterParam(event, 'id')
  const { supabase } = await requirePermission(event, 'billing_access')

  const data = await loadFacturaDocumentData(supabase, facturaId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Factura not found' })
  }

  const [pdf] = await Promise.all([
    generateInvoicePdf(data),
    logPatientAccess(supabase, data.accountId, 'invoice_pdf', data.patientId, { factura: data.invoiceNumber }),
  ])

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${data.invoiceNumber}.pdf"`)
  return pdf
})
