import { sendInboxMessage } from '~/server/utils/inboxSend'
import { buildProtectedPdf, ProtectedPdfError } from '~/server/utils/protectedPdf'
import { MIN_DOCUMENT_PASSWORD_LENGTH, captionRevealsPassword, defaultProtectedCaption, documentPassword, isSpanishId, protectedFileName } from '~/utils/protectedDocument'

// Sends one of a patient's files into their WhatsApp chat as a PDF that only
// opens with a password -- their DNI/NIE, or one the clinic tells them.
// utils/protectedDocument.ts has the why.
//
// Sent through the Inbox's own path (server/utils/inboxSend.ts), so it gets
// exactly the Inbox's rules: Inbox access to send at all, the 24h window
// WhatsApp allows free-form messages in, the patient's do-not-contact and
// under-age stops, and a message row the conversation shows. The file is read
// under the sender's own session, so the files scope of their role decides
// whether they can reach it, as it does on the Files tab.
//
// Nothing here stores the password. The chat keeps the encrypted copy that
// was sent, which is all a forwarded or backed-up message would carry.
export default defineEventHandler(async (event) => {
  const fileId = getRouterParam(event, 'id')
  if (!fileId) throw createError({ statusCode: 400, statusMessage: 'Missing file id' })

  const body = (await readBody<{ password?: unknown; caption?: unknown; saveAsNationalId?: unknown }>(event).catch(() => null)) ?? {}
  const password = typeof body.password === 'string' ? documentPassword(body.password) : ''
  if (password.length < MIN_DOCUMENT_PASSWORD_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `The password needs at least ${MIN_DOCUMENT_PASSWORD_LENGTH} characters.` })
  }

  const access = await requirePermission(event, 'inbox_access')
  const { supabase } = access

  const { data: file } = await supabase.from('patient_files').select('id, patient_id, storage_path, file_name, file_type').eq('id', fileId).maybeSingle()
  if (!file?.storage_path) throw createError({ statusCode: 404, statusMessage: 'File not found' })

  const { data: patient } = await supabase.from('patients').select('id, national_id, preferred_language').eq('id', file.patient_id).maybeSingle()
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  const storedId = patient.national_id ? documentPassword(patient.national_id) : null
  const passwordIsNationalId = isSpanishId(password) && (storedId === password || body.saveAsNationalId === true)
  const caption =
    typeof body.caption === 'string' && body.caption.trim()
      ? body.caption.trim()
      : defaultProtectedCaption({ fileName: file.file_name, passwordIsNationalId, english: patient.preferred_language === 'en' })
  // The one rule that is not a preference: a message carrying its own key
  // is not protected.
  if (captionRevealsPassword(caption, password)) {
    throw createError({ statusCode: 400, statusMessage: 'The message must not contain the password. Tell the patient which password it is, not what it is.' })
  }

  const { data: downloaded, error: downloadError } = await supabase.storage.from('patient-files').download(file.storage_path)
  if (downloadError || !downloaded) throw createError({ statusCode: 502, statusMessage: 'Could not read the file.' })

  let pdf: Buffer
  try {
    pdf = await buildProtectedPdf(Buffer.from(await downloaded.arrayBuffer()), file.file_type, password)
  } catch (err) {
    if (err instanceof ProtectedPdfError) throw createError({ statusCode: 400, statusMessage: err.message })
    throw err
  }

  await sendInboxMessage(event, access, {
    patientId: patient.id,
    mediaBuffer: pdf,
    mediaMimeType: 'application/pdf',
    mediaFilename: protectedFileName(file.file_name),
    mediaKind: 'document',
    caption,
  })

  // Only once it has gone, and only into an empty field: a DNI typed here to
  // protect a document is worth keeping, but never over one already on file.
  if (body.saveAsNationalId === true && isSpanishId(password) && !patient.national_id) {
    await supabase.from('patients').update({ national_id: password }).eq('id', patient.id)
  }

  return { success: true, fileName: protectedFileName(file.file_name) }
})
