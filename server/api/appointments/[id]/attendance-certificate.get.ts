// The justificante de asistencia for one visit, as a PDF to print or hand
// over. Anyone who can see the patient can make one, as with the
// appointment history: it says no more than that they came. ?lang=es|en
// overrides the patient's preferred language.
export default defineEventHandler(async (event) => {
  const appointmentId = getRouterParam(event, 'id')
  if (!appointmentId) throw createError({ statusCode: 400, statusMessage: 'Missing appointment id' })

  const { supabase, teamMember } = await requireActiveAccount(event)
  const lang = getQuery(event).lang
  const result = await loadAttendanceCertificateData(supabase, teamMember.account_id, appointmentId, typeof lang === 'string' ? lang : null)
  if (!result.ok && result.reason === 'not_found') throw createError({ statusCode: 404, statusMessage: 'Appointment not found' })
  if (!result.ok) throw createError({ statusCode: 409, statusMessage: 'Only a visit that took place has a certificate of attendance.' })

  // The appointment row is readable more widely than the patient behind it
  // (a colleague's calendar), so the patient is checked on its own.
  await requirePatientAccess(event, result.data.patientId)

  const [pdf] = await Promise.all([
    generateAttendanceCertificatePdf(result.data),
    logPatientAccess(supabase, teamMember.account_id, 'export', result.data.patientId, { document: 'attendance_certificate', appointment_id: appointmentId }),
  ])

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="justificante-${appointmentId}.pdf"`)
  return pdf
})
