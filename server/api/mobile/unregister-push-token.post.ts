// Called on sign-out so a shared/reset device stops receiving another
// user's pushes.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event)
  if (!body?.token) {
    throw createError({ statusCode: 400, statusMessage: 'token is required' })
  }

  const { supabase, user } = await requireAuthedUser(event)
  await supabase.from('device_push_tokens').delete().eq('user_id', user.id).eq('fcm_token', body.token)

  return { success: true }
})
