export default defineEventHandler(async (event) => {
  const invoiceId = getRouterParam(event, 'id')
  const { supabase } = await requirePermission(event, 'billing_access')

  const data = await loadInvoiceDocumentData(supabase, invoiceId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }
  if (!data.patient.email) {
    throw createError({ statusCode: 400, statusMessage: 'Patient has no email address' })
  }

  const pdf = await generateInvoicePdf(data)

  const rows = data.lineItems
    .map(
      (l) =>
        `<tr><td style="padding:4px 8px">${l.description}</td><td style="padding:4px 8px;text-align:right">${l.quantity}</td><td style="padding:4px 8px;text-align:right">€${((l.price_cents * l.quantity) / 100).toFixed(2)}</td></tr>`,
    )
    .join('')

  const html = `
    <div style="font-family:sans-serif">
      <h2>Invoice ${data.invoiceNumber}</h2>
      <p>Hi ${data.patient.firstName},</p>
      <p>Here is your invoice -- the full PDF is attached.</p>
      <table style="border-collapse:collapse;width:100%">
        <thead><tr><th align="left">Description</th><th align="right">Qty</th><th align="right">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px"><strong>Total: €${(data.totalCents / 100).toFixed(2)}</strong></p>
    </div>
  `

  await sendResendEmail({
    to: data.patient.email,
    subject: `Invoice ${data.invoiceNumber}`,
    html,
    attachments: [{ filename: `${data.invoiceNumber}.pdf`, content: pdf.toString('base64') }],
  })

  return { sent: true }
})
