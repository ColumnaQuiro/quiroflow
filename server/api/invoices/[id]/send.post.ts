export default defineEventHandler(async (event) => {
  const invoiceId = getRouterParam(event, 'id')
  const config = useRuntimeConfig()
  const { supabase } = await requirePermission(event, 'billing_access')

  const data = await loadInvoiceDocumentData(supabase, invoiceId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }
  if (!data.patient.email) {
    throw createError({ statusCode: 400, statusMessage: 'Patient has no email address' })
  }

  if (!config.resendApiKey) {
    throw createError({ statusCode: 500, statusMessage: 'Email sending is not configured (missing RESEND_API_KEY)' })
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

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'QuiroFlow <notifications@quiroflow.com>',
      to: data.patient.email,
      subject: `Invoice ${data.invoiceNumber}`,
      html,
      attachments: [{ filename: `${data.invoiceNumber}.pdf`, content: pdf.toString('base64') }],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw createError({ statusCode: 502, statusMessage: `Resend error: ${body}` })
  }

  return { sent: true }
})
