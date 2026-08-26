export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  const { supabase } = await requirePermission(event, 'patients_access')

  const data = await loadAppointmentHistoryData(supabase, patientId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }

  const pdf = await generateAppointmentHistoryPdf(data)

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="appointment-history-${patientId}.pdf"`)
  return pdf
})
