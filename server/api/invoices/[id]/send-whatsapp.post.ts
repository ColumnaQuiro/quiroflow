// "Send by WhatsApp" on a receipt: the PDF send.post.ts emails, in the
// document header of the clinic's invoice template. The body names no
// recipient on purpose -- it goes to the patient the receipt belongs to.
export default defineEventHandler(async (event) => {
  const invoiceId = getRouterParam(event, 'id')
  const access = await requirePermission(event, 'billing_access')

  const data = await loadInvoiceDocumentData(access.supabase, invoiceId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }

  return sendInvoiceByWhatsApp(event, access, data)
})
