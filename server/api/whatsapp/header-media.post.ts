import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { requirePermission } from '~/server/utils/requirePermission'

// Stores the media a template header needs -- the video on a welcome message,
// an image on an offer.
//
// Uploaded through the server rather than straight from the browser so the
// whatsapp-media bucket can stay private. Anything a clinic sends a patient
// lives there, and opening it to browser writes would mean a storage policy
// broad enough to cover patient documents too. The sender reads this back as
// a short-lived signed URL at send time; nothing here is ever public.
const MAX_BYTES = 15 * 1024 * 1024

// What Meta accepts in a template header, and nothing else. The list is not
// about our storage -- an .exe would upload perfectly well -- it is about
// refusing at the door something that can only fail later, in front of a
// patient, as a template rejected mid-drip.
const ALLOWED: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png'],
  video: ['video/mp4', 'video/3gpp'],
  document: ['application/pdf'],
}

export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'communication_config')

  const form = await readMultipartFormData(event)
  const file = form?.find((part) => part.name === 'file' && part.filename)
  const kind = form?.find((part) => part.name === 'kind')?.data?.toString() ?? ''

  if (!file?.data) throw createError({ statusCode: 400, statusMessage: 'No file was uploaded.' })
  if (!ALLOWED[kind]) throw createError({ statusCode: 400, statusMessage: 'kind must be image, video or document.' })
  if (file.data.length > MAX_BYTES) {
    throw createError({ statusCode: 400, statusMessage: `That file is larger than ${MAX_BYTES / (1024 * 1024)} MB, which WhatsApp will not accept.` })
  }

  const type = file.type ?? ''
  if (!ALLOWED[kind]!.includes(type)) {
    throw createError({
      statusCode: 400,
      statusMessage: `WhatsApp accepts ${ALLOWED[kind]!.join(' or ')} for a ${kind} header, not ${type || 'an unknown type'}.`,
    })
  }

  const safeName = (file.filename ?? 'header')
    .toLowerCase()
    .replace(/[^a-z0-9.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-80)

  // Account-scoped, matching the rest of whatsapp-media.
  const path = `${teamMember.account_id}/campaigns/${Date.now()}-${safeName}`

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { error } = await supabase.storage.from('whatsapp-media').upload(path, file.data, {
    contentType: type,
    upsert: false,
  })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { storage_path: path, filename: safeName, bytes: file.data.length }
})
