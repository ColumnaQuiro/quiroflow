// Any signed-in staff member can generate one of these -- it's a low-stakes
// convenience action ("let me use my phone's camera instead"), not a
// sensitive operation that needs a specific permission gate.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ patientId: string }>(event)
  if (!body?.patientId) {
    throw createError({ statusCode: 400, statusMessage: 'patientId is required' })
  }

  const { supabase, teamMember } = await requireTeamMember(event)

  const { data, error } = await supabase
    .from('photo_upload_tokens')
    .insert({ account_id: teamMember.account_id, patient_id: body.patientId })
    .select('token')
    .single()
  if (error || !data) {
    throw createError({ statusCode: 500, statusMessage: error?.message ?? 'Failed to create token' })
  }

  return { token: data.token }
})
