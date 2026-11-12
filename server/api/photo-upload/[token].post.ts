import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { IMMUTABLE_CACHE_SECONDS } from '~/utils/storageCache'

const TOKEN_TTL_MINUTES = 10

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token) throw createError({ statusCode: 400, statusMessage: 'Missing token' })

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: row } = await supabase
    .from('photo_upload_tokens')
    .select('account_id, patient_id, created_at, used_at')
    .eq('token', token)
    .maybeSingle()

  if (!row) throw createError({ statusCode: 404, statusMessage: 'This link is invalid.' })
  if (row.used_at) throw createError({ statusCode: 410, statusMessage: 'This link has already been used.' })
  const ageMinutes = (Date.now() - new Date(row.created_at).getTime()) / 60000
  if (ageMinutes > TOKEN_TTL_MINUTES) throw createError({ statusCode: 410, statusMessage: 'This link has expired.' })

  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'file')
  if (!file || !file.data.length) {
    throw createError({ statusCode: 400, statusMessage: 'No photo received.' })
  }

  const extension = (file.type?.split('/')[1] ?? 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg'
  const path = `${row.account_id}/${row.patient_id}/${Date.now()}.${extension}`

  const { data: before } = await supabase.from('patients').select('photo_storage_path').eq('id', row.patient_id).eq('account_id', row.account_id).maybeSingle()

  const { error: uploadError } = await supabase.storage.from('patient-photos').upload(path, file.data, {
    contentType: file.type ?? 'image/jpeg',
    upsert: false,
    // A timestamped name never serves different bytes.
    cacheControl: IMMUTABLE_CACHE_SECONDS,
  })
  if (uploadError) throw createError({ statusCode: 500, statusMessage: uploadError.message })

  const { error: saveError } = await supabase.from('patients').update({ photo_storage_path: path }).eq('id', row.patient_id).eq('account_id', row.account_id)
  if (saveError) {
    // Nothing points at the new file, so it must not stay behind.
    await removeStorageObjects(supabase, 'patient-photos', [path], 'photo upload not saved')
    throw createError({ statusCode: 500, statusMessage: saveError.message })
  }
  // The photo this one replaces, which used to stay in the bucket for good.
  // Only inside this account's folder, and only if no other record shows it.
  const previous = before?.photo_storage_path
  if (previous && previous !== path && previous.startsWith(`${row.account_id}/`)) {
    const { count } = await supabase.from('patients').select('id', { count: 'exact', head: true }).eq('account_id', row.account_id).eq('photo_storage_path', previous)
    if (count === 0) await removeStorageObjects(supabase, 'patient-photos', [previous], 'patient photo replaced')
  }
  await supabase.from('photo_upload_tokens').update({ used_at: new Date().toISOString() }).eq('token', token)

  return { success: true }
})
