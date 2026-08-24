import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Called by the phone that scanned the QR code -- no session at all, so this
// validates the token itself (exists, unused, unexpired) rather than any
// RLS-gated auth, same reasoning as the public booking RPCs.
const TOKEN_TTL_MINUTES = 10

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw createError({ statusCode: 400, statusMessage: 'Missing token' })

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: row } = await supabase
    .from('photo_upload_tokens')
    .select('created_at, used_at, patients(first_name)')
    .eq('token', token)
    .maybeSingle()

  if (!row) throw createError({ statusCode: 404, statusMessage: 'This link is invalid.' })
  if (row.used_at) throw createError({ statusCode: 410, statusMessage: 'This link has already been used.' })
  const ageMinutes = (Date.now() - new Date(row.created_at).getTime()) / 60000
  if (ageMinutes > TOKEN_TTL_MINUTES) throw createError({ statusCode: 410, statusMessage: 'This link has expired.' })

  return { patientFirstName: row.patients?.first_name ?? '' }
})
