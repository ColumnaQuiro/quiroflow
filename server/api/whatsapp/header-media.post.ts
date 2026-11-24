import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { requirePermission } from '~/server/utils/requirePermission'
import { WHATSAPP_HEADER_MEDIA_MAX_BYTES, WHATSAPP_HEADER_MEDIA_TYPES, whatsappHeaderMediaProblem, whatsappHeaderMediaSafeName } from '~/utils/whatsappHeaderMedia'

// Lets an automation step store the media its template header needs -- the
// video on a welcome message, an image on an offer.
//
// This route never sees the file. It used to: the browser posted it here as
// multipart and the route wrote it to Storage. But a Netlify function refuses
// any request over ~6 MB before our code runs, so a 1:46 clinic video
// (18 MB) failed with nothing logged anywhere while one of 4.5 MB went
// through, and the clinic could not tell why one worked and the other did
// not.
//
// Now the browser says what it is about to upload, this route checks the
// permission, the type and the size, and answers with a one-off signed
// upload URL for a path inside the clinic's own folder. The browser puts the
// file there directly. The whatsapp-media bucket stays private, as before:
// the token writes that one path, and the sender reads the file back as a
// short-lived signed URL at send time. Nothing here is ever public.
//
// The size checked is the one the browser declares; a signed upload cannot
// cap it. Lying about it only gets a clinic its own template refused by
// Meta, so it is checked here for the honest case and not enforced further.

export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'communication_config')

  const body = await readBody<{ kind?: unknown; filename?: unknown; contentType?: unknown; bytes?: unknown }>(event)
  const kind = typeof body?.kind === 'string' ? body.kind : ''
  const contentType = typeof body?.contentType === 'string' ? body.contentType : ''
  const bytes = typeof body?.bytes === 'number' ? body.bytes : 0
  const filename = typeof body?.filename === 'string' ? body.filename : ''

  const problem = whatsappHeaderMediaProblem(kind, contentType, bytes)
  if (problem === 'kind') throw createError({ statusCode: 400, statusMessage: 'kind must be image, video or document.' })
  if (problem === 'too_large') {
    throw createError({ statusCode: 400, statusMessage: `That file is larger than ${WHATSAPP_HEADER_MEDIA_MAX_BYTES / (1024 * 1024)} MB, which WhatsApp will not accept.` })
  }
  if (problem === 'type') {
    throw createError({
      statusCode: 400,
      statusMessage: `WhatsApp accepts ${WHATSAPP_HEADER_MEDIA_TYPES[kind]!.join(' or ')} for a ${kind} header, not ${contentType || 'an unknown type'}.`,
    })
  }

  // Account-scoped, matching the rest of whatsapp-media.
  const safeName = whatsappHeaderMediaSafeName(filename)
  const path = `${teamMember.account_id}/campaigns/${Date.now()}-${safeName}`

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data, error } = await supabase.storage.from('whatsapp-media').createSignedUploadUrl(path)
  if (error || !data) throw createError({ statusCode: 500, statusMessage: error?.message ?? 'Could not prepare the upload.' })

  return { storage_path: path, filename: safeName, token: data.token }
})
