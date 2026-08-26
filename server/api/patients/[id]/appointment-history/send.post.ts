export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  const { supabase } = await requirePermission(event, 'patients_access')

  const data = await loadAppointmentHistoryData(supabase, patientId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }
  if (!data.patient.email) {
    throw createError({ statusCode: 400, statusMessage: 'Patient has no email address' })
  }

  const pdf = await generateAppointmentHistoryPdf(data)

  const html = `
    <div style="font-family:sans-serif">
      <h2>Appointment History</h2>
      <p>Hi ${data.patient.firstName},</p>
      <p>Here is your appointment history -- the full PDF is attached.</p>
    </div>
  `

  await sendResendEmail({
    to: data.patient.email,
    subject: 'Your appointment history',
    html,
    attachments: [{ filename: 'appointment-history.pdf', content: pdf.toString('base64') }],
  })

  return { sent: true }
})
