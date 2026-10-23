import { generateLetterPdf, loadClinicLogo, loadLetterClinic } from '~/server/utils/letterData'
import { logPatientAccess } from '~/server/utils/patientAccessLog'
import { letterFileName } from '~/utils/letters'

// A letter from the patient record, as a PDF on the clinic's letterhead, to
// download or print (?inline=1, which the browser opens rather than saves).
// Read with the caller's own client, so the record's rules apply: the
// patient's scope and the role's "own documents" scope (patient_letters RLS).
// Logged in the patient's access log as an export, as every PDF of the
// record is.
export default defineEventHandler(async (event) => {
  const letterId = getRouterParam(event, 'id')
  if (!letterId) throw createError({ statusCode: 400, statusMessage: 'Missing letter id' })

  const { supabase, teamMember } = await requireActiveAccount(event)
  const { data: letter } = await supabase
    .from('patient_letters')
    .select('id, patient_id, clinic_id, title, body, show_logo, created_at')
    .eq('id', letterId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!letter) throw createError({ statusCode: 404, statusMessage: 'Letter not found' })
  await requirePatientAccess(event, letter.patient_id)

  const clinic = await loadLetterClinic(supabase, teamMember.account_id, letter.clinic_id)
  const logoBuffer = letter.show_logo ? await loadClinicLogo(supabase, clinic?.logoStoragePath ?? null) : null
  const inline = getQuery(event).inline === '1'

  const [pdf] = await Promise.all([
    generateLetterPdf({ body: letter.body, clinic, logoBuffer }),
    logPatientAccess(supabase, teamMember.account_id, 'export', letter.patient_id, { document: 'letter', letter_id: letter.id, title: letter.title, printed: inline }),
  ])

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${letterFileName(letter.title, letter.created_at)}"`)
  return pdf
})
