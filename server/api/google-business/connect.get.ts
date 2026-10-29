import { consentUrl, googleBusinessConfigured, signedState } from '~/server/utils/googleBusiness'

// Starts connecting the clinic's Google Business Profile: the URL of Google's
// consent screen, which the page then sends the browser to. Returned rather
// than redirected to, because this call carries the staff session as a header
// that a plain link could not.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  if (!googleBusinessConfigured()) throw createError({ statusCode: 501, statusMessage: 'Google reviews are not configured on this deployment.' })
  return { url: consentUrl(getRequestURL(event).origin, signedState(teamMember.account_id, teamMember.id)) }
})
