import { isDisposableEmail } from '~/server/utils/disposableEmail'
import { throttlePublic } from '~/server/utils/publicRateLimit'

// Asked by /signup before it creates the auth user: is this a throwaway
// inbox? Answers only that, so it tells a caller nothing about who has an
// account. Public because the person asking has no session yet.
//
// The page treats a failed call as "allowed" -- this is a filter in front of
// signup, never a reason a real clinic cannot create its account.
export default defineEventHandler(async (event) => {
  await throttlePublic(event, { scope: 'signup-email-check', limit: 30, windowSeconds: 600 })
  const body = await readBody<{ email?: unknown }>(event)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!email.includes('@') || email.length > 320) {
    throw createError({ statusCode: 400, statusMessage: 'email required' })
  }
  return { disposable: await isDisposableEmail(email) }
})
