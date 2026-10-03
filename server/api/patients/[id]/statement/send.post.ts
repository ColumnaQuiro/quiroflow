export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  // billing_history_view too: see statement.get.ts.
  const { supabase } = await requireAllPermissions(event, ['billing_access', 'billing_history_view'])

  const data = await loadStatementDocumentData(supabase, patientId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }
  // The same refusal as every other way of reaching a patient -- the
  // WhatsApp version of this send, the email composer, the automations: a
  // minor is not written to directly, and "do not contact" means no channel.
  const { data: flags } = await supabase.from('patients').select('is_minor, do_not_contact').eq('id', patientId!).maybeSingle()
  if (!flags) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  if (flags.is_minor || flags.do_not_contact) {
    throw createError({ statusCode: 400, statusMessage: 'This patient cannot be contacted (under age or marked do not contact).' })
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
