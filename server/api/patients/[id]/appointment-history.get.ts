export default defineEventHandler(async (event) => {
  // Was requirePermission('patients_access') -- a key no role has ever had,
  // so everyone but an owner got a 403. Seeing the patient is the gate.
  const { supabase, patientId } = await requirePatientAccess(event, getRouterParam(event, 'id'))

  const data = await loadAppointmentHistoryData(supabase, patientId)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }

  const pdf = await generateAppointmentHistoryPdf(data)

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="appointment-history-${patientId}.pdf"`)
  return pdf
})
