import { serverSupabaseClient } from '#supabase/server'

export default defineEventHandler(async (event) => {
  const invoiceId = getRouterParam(event, 'id')
  const supabase = await serverSupabaseClient(event)
  const config = useRuntimeConfig()

  const { data: invoice } = await supabase
    .from('invoices')
    .select('invoice_number, total_cents, patients(first_name, last_name, email)')
    .eq('id', invoiceId)
    .maybeSingle()

  if (!invoice) {
    throw createError({ statusCode: 404, statusMessage: 'Invoice not found' })
  }

  const patient = invoice.patients as unknown as { first_name: string; last_name: string | null; email: string | null } | null
  if (!patient?.email) {
    throw createError({ statusCode: 400, statusMessage: 'Patient has no email address' })
  }

  if (!config.resendApiKey) {
    throw createError({ statusCode: 500, statusMessage: 'Email sending is not configured (missing RESEND_API_KEY)' })
  }

  const { data: lineItems } = await supabase
    .from('invoice_line_items')
    .select('description, quantity, price_cents')
    .eq('invoice_id', invoiceId)

  const rows = (lineItems ?? [])
    .map(
      (l) =>
        `<tr><td style="padding:4px 8px">${l.description}</td><td style="padding:4px 8px;text-align:right">${l.quantity}</td><td style="padding:4px 8px;text-align:right">€${((l.price_cents * l.quantity) / 100).toFixed(2)}</td></tr>`,
    )
    .join('')

  const html = `
    <div style="font-family:sans-serif">
      <h2>Invoice ${invoice.invoice_number}</h2>
      <p>Hi ${patient.first_name},</p>
      <p>Here is your invoice:</p>
      <table style="border-collapse:collapse;width:100%">
        <thead><tr><th align="left">Description</th><th align="right">Qty</th><th align="right">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px"><strong>Total: €${(invoice.total_cents / 100).toFixed(2)}</strong></p>
    </div>
  `

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'QuiroFlow <onboarding@resend.dev>',
      to: patient.email,
      subject: `Invoice ${invoice.invoice_number}`,
      html,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw createError({ statusCode: 502, statusMessage: `Resend error: ${body}` })
  }

  return { sent: true }
})
