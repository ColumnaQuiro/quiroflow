export default defineEventHandler(async (event) => {
  const patientId = getRouterParam(event, 'id')
  // The statement is the patient's whole billing history on paper, so it sits
  // behind billing_history_view as well as billing_access, like the Money tab.
  const { supabase } = await requireAllPermissions(event, ['billing_access', 'billing_history_view'])

  const data = await loadStatementDocumentData(supabase, patientId!)
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'Patient not found' })
  }

  const pdf = await generateStatementPdf(data)

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="statement-${patientId}.pdf"`)
  return pdf
})
