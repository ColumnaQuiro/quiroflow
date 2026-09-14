import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Stores the clinic's Meta App Secret, which the webhook uses to verify that an
// inbound request really came from Meta.
//
// A server route rather than a direct table write from the settings page,
// because whatsapp_app_secrets grants nothing to `authenticated` -- it is
// service-role only, so the value cannot be read back out through the REST API
// by any staff member the way accounts.stripe_secret_key currently can be.
// Write-only by design: there is no GET returning the secret, only
// app-secret.get.ts saying whether one is set.
export default defineEventHandler(async (event) => {
  // communication_config is the permission that already gates the rest of
  // Settings > WhatsApp, so setting this needs no more and no less than
  // configuring the templates beside it.
  const { teamMember } = await requireSettingsPermission(event, 'communication_config')
  const body = await readBody<{ appSecret?: string }>(event)

  const appSecret = (body?.appSecret ?? '').trim()
  if (!appSecret) {
    throw createError({ statusCode: 400, statusMessage: 'appSecret is required.' })
  }
  // Meta App Secrets are 32-character hex. Checked so a pasted App *ID*, or a
  // truncated copy, fails here with something readable rather than silently
  // rejecting every genuine webhook from then on.
  if (!/^[0-9a-f]{32}$/i.test(appSecret)) {
    throw createError({
      statusCode: 400,
      statusMessage: "That doesn't look like a Meta App Secret (32 hexadecimal characters). Copy it from Meta App dashboard > Settings > Basic > App Secret.",
    })
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const { error } = await admin
    .from('whatsapp_app_secrets')
    .upsert({ account_id: teamMember.account_id, app_secret: appSecret, updated_at: new Date().toISOString() }, { onConflict: 'account_id' })

  if (error) {
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { configured: true }
})
