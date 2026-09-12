export default defineEventHandler(async (event) => {
  const facturaId = getRouterParam(event, 'id')
  const { supabase } = await requirePermission(event, 'billing_access')

  const data = await loadFacturaDocumentData(supabase, facturaId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Factura not found' })
  }
  if (!data.patient.email) {
    throw createError({ statusCode: 400, statusMessage: 'Patient has no email address' })
  }

  const pdf = await generateInvoicePdf(data)
  const line = data.lineItems[0]

  // Deliberately short. This is a receipt for money already paid, not a
  // request for anything, so it says what was bought and what it cost and
  // stops -- no table of quantities, no balance, no call to action.
  const html = `
    <div style="font-family:sans-serif">
      <h2>${data.documentTitle}</h2>
      <p>Hola ${data.patient.firstName},</p>
      <p>Adjuntamos tu factura por el pago recibido.</p>
      <p style="margin-top:16px">${line?.description ?? ''}<br />
      <strong>€${(data.totalCents / 100).toFixed(2)}</strong></p>
    </div>
  `

  await sendResendEmail({
    to: data.patient.email,
    subject: `${data.documentTitle}`,
    html,
    attachments: [{ filename: `${data.invoiceNumber}.pdf`, content: pdf.toString('base64') }],
  })

  return { sent: true }
})
