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

  // The clinic's own subject and message (Settings > Invoicing), with
  // {{clinic_name}} and {{patient_name}} (their first name) filled in; the
  // built-in wording when it has written none.
  const clinicName = data.clinic?.name ?? ''
  const fill = (text: string) =>
    text.replace(/\{\{\s*clinic_name\s*\}\}/g, clinicName).replace(/\{\{\s*patient_name\s*\}\}/g, data.patient.firstName)
  const intro = data.email?.body
    ? fill(data.email.body)
        .split(/\n{2,}/)
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
        .join('')
    : `<p>Hi ${escapeHtml(data.patient.firstName)},</p>
      <p>Here is the receipt for your visit -- the full PDF is attached. The
      invoice (factura) for what you paid is issued separately.</p>`

  const html = `
    <div style="font-family:sans-serif">
      <h2>Recibo ${data.invoiceNumber}</h2>
      ${intro}
      <table style="border-collapse:collapse;width:100%">
        <thead><tr><th align="left">Description</th><th align="right">Qty</th><th align="right">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px"><strong>Total: €${(data.totalCents / 100).toFixed(2)}</strong></p>
    </div>
  `

  await sendResendEmail({
    to: data.patient.email,
    subject: data.email?.subject ? fill(data.email.subject) : `Recibo ${data.invoiceNumber}`,
    html,
    attachments: [{ filename: `${data.invoiceNumber}.pdf`, content: pdf.toString('base64') }],
  })

  return { sent: true }
})

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
