// Called by the mobile app after Capacitor's push-notification registration
// succeeds, so server/utils/pushNotifications.ts knows where to send.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string; platform?: 'ios' | 'android' | 'web' }>(event)
  if (!body?.token || !body?.platform) {
    throw createError({ statusCode: 400, statusMessage: 'token and platform are required' })
  }

  const { supabase, user } = await requireAuthedUser(event)
  const { error } = await supabase
    .from('device_push_tokens')
    .upsert({ user_id: user.id, platform: body.platform, fcm_token: body.token }, { onConflict: 'user_id,fcm_token' })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  return { success: true }
})
