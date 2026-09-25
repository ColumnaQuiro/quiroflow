export default defineEventHandler(async (event) => {
  // Was requirePermission('patients_access') -- a key no role has ever had,
  // so everyone but an owner got a 403. Seeing the patient is the gate.
  const { supabase, patientId } = await requirePatientAccess(event, getRouterParam(event, 'id'))

  const data = await loadAppointmentHistoryData(supabase, patientId)
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
