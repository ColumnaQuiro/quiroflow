export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  // billing_history_view too: see statement.get.ts.
  const { supabase } = await requireAllPermissions(event, ['billing_access', 'billing_history_view'])

  const data = await loadStatementDocumentData(supabase, patientId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }
  if (!data.patient.email) {
    throw createError({ statusCode: 400, statusMessage: 'Patient has no email address' })
  }

  const pdf = await generateStatementPdf(data)

  const html = `
    <div style="font-family:sans-serif">
      <h2>Account Statement</h2>
      <p>Hi ${data.patient.firstName},</p>
      <p>Here is your account statement -- the full PDF is attached.</p>
      <p style="margin-top:16px"><strong>Closing balance: €${(Math.abs(data.closingBalanceCents) / 100).toFixed(2)} ${data.closingBalanceCents < 0 ? 'due' : 'credit'}</strong></p>
    </div>
  `

  await sendResendEmail({
    to: data.patient.email,
    subject: 'Your account statement',
    html,
    attachments: [{ filename: 'statement.pdf', content: pdf.toString('base64') }],
  })

  return { sent: true }
})
