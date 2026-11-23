// "WhatsApp" beside "Send" on a factura: the PDF send.post.ts emails, in the
// document header of the clinic's invoice template. It goes to the patient
// whose record the factura is on, whoever it is addressed to.
export default defineEventHandler(async (event) => {
  const facturaId = getRouterParam(event, 'id')
  const access = await requirePermission(event, 'billing_access')

  const data = await loadFacturaDocumentData(access.supabase, facturaId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Factura not found' })
  }

  return sendInvoiceByWhatsApp(event, access, data)
})
