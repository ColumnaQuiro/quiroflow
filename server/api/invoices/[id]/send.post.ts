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

  // Spanish and in euros the Spanish way ("45,00 €"): these go to patients.
  // A line's description is typed by staff, so it is escaped like the body.
  const eur = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100)
  const rows = data.lineItems
    .map(
      (l) =>
        `<tr><td style="padding:4px 8px">${escapeHtml(l.description)}</td><td style="padding:4px 8px;text-align:right">${l.quantity}</td><td style="padding:4px 8px;text-align:right">${eur(l.price_cents * l.quantity)}</td></tr>`,
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
    : `<p>Hola ${escapeHtml(data.patient.firstName)}:</p>
      <p>Te enviamos el recibo de tu visita; lo tienes completo en el PDF
      adjunto. La factura de lo que has pagado se emite por separado.</p>`

  const html = `
    <div style="font-family:sans-serif">
      <h2>Recibo ${data.invoiceNumber}</h2>
      ${intro}
      <table style="border-collapse:collapse;width:100%">
        <thead><tr><th align="left">Concepto</th><th align="right">Cant.</th><th align="right">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px"><strong>Total: ${eur(data.totalCents)}</strong></p>
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
