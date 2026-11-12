import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// What Settings > Payments shows about GoCardless. `refresh=1` re-reads the
// verification status from GoCardless, which changes on its side as the
// clinic finishes onboarding there.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'billing_config')
  setHeader(event, 'Cache-Control', 'no-store')
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: account } = await admin
    .from('accounts')
    .select('gocardless_organisation_id, gocardless_environment, gocardless_verification_status, gocardless_connected_at')
    .eq('id', teamMember.account_id)
    .maybeSingle()

  let verification = account?.gocardless_verification_status ?? null
  let tokenGone = false
  if (account?.gocardless_organisation_id && getQuery(event).refresh === '1') {
    const request = await gocardlessForAccount(admin, teamMember.account_id)
    if (request) {
      try {
        const creditors = await request('GET', '/creditors', { query: { limit: 1 } })
        verification = creditors?.creditors?.[0]?.verification_status ?? verification
        await admin.from('accounts').update({ gocardless_verification_status: verification }).eq('id', teamMember.account_id)
      } catch (err) {
        if (err instanceof GoCardlessError && err.tokenGone) tokenGone = true
        else console.error('[gocardless status] could not refresh', (err as Error).message)
      }
    }
  }

  if (tokenGone) {
    await forgetGoCardlessConnection(admin, teamMember.account_id)
    return { configured: gocardlessConfigured(), connected: false, revokedElsewhere: true }
  }

  return {
    configured: gocardlessConfigured(),
    connected: Boolean(account?.gocardless_organisation_id),
    organisationId: account?.gocardless_organisation_id ?? null,
    environment: account?.gocardless_environment ?? null,
    verificationStatus: verification,
    connectedAt: account?.gocardless_connected_at ?? null,
  }
})
