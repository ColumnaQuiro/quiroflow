import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Stores the legacy per-clinic Stripe credentials, which used to be written
// straight to `accounts` from the settings page.
//
// They now live in account_secrets, which grants nothing to `authenticated` --
// so the browser can neither read them back nor write them, and a receptionist
// can no longer fetch the key that charges the clinic's cards. Write-only by
// design: there is no route that returns a value, only secrets.get.ts saying
// which are set.
export default defineEventHandler(async (event) => {
  // billing_config already gates the rest of Settings > Payments, so this
  // needs no more and no less than the fields beside it.
  const { teamMember } = await requireSettingsPermission(event, 'billing_config')
  const body = await readBody<{ secretKey?: string; webhookSecret?: string }>(event)

  const secretKey = (body?.secretKey ?? '').trim()
  const webhookSecret = (body?.webhookSecret ?? '').trim()
  if (!secretKey && !webhookSecret) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to save.' })
  }

  // Caught here rather than at the first failed charge: a publishable key
  // pasted into the secret field is an easy slip, and Stripe would otherwise
  // only complain at payment time.
  if (secretKey && !/^(sk|rk)_(test|live)_/.test(secretKey)) {
    throw createError({
      statusCode: 400,
      statusMessage: "That doesn't look like a Stripe secret key (it should start with sk_live_, sk_test_ or rk_). The pk_ key is the publishable one and belongs in the field above.",
    })
  }
  if (webhookSecret && !webhookSecret.startsWith('whsec_')) {
    throw createError({ statusCode: 400, statusMessage: "A Stripe webhook signing secret starts with 'whsec_'." })
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  if (secretKey) await setAccountSecret(admin, teamMember.account_id, 'stripe_secret_key', secretKey)
  if (webhookSecret) await setAccountSecret(admin, teamMember.account_id, 'stripe_webhook_secret', webhookSecret)

  return await accountSecretStatus(admin, teamMember.account_id)
})
