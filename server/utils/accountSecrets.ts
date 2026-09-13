import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'

// Reading integration credentials from somewhere the clinic's own staff
// cannot. They used to sit in columns on `accounts`, whose RLS grants every
// member SELECT and UPDATE on the whole row -- so a receptionist could fetch
// the live Stripe secret key through the REST API and overwrite it. See the
// account_secrets migration for why a column-level grant cannot fix that.
//
// Only reachable with the service role, which means only from server routes.

export type AccountSecretName = 'stripe_secret_key' | 'stripe_webhook_secret'

/**
 * The named secret for this account, or null.
 *
 * Falls back to the legacy `accounts` column while the two sources coexist, so
 * this works in either order: a database migrated before the code deploys, or
 * code deployed before the columns are emptied. The fallback goes away with
 * the columns.
 */
export async function getAccountSecret(
  supabase: SupabaseClient<Database>,
  accountId: string,
  name: AccountSecretName,
): Promise<string | null> {
  const { data } = await supabase.from('account_secrets').select('value').eq('account_id', accountId).eq('name', name).maybeSingle()
  if (data?.value) return data.value

  const { data: legacy } = await supabase.from('accounts').select(name).eq('id', accountId).maybeSingle()
  return (legacy as Record<string, string | null> | null)?.[name] ?? null
}

/** Both Stripe secrets at once, so a call site needing them makes one round trip. */
export async function getStripeSecrets(supabase: SupabaseClient<Database>, accountId: string) {
  const [secretKey, webhookSecret] = await Promise.all([
    getAccountSecret(supabase, accountId, 'stripe_secret_key'),
    getAccountSecret(supabase, accountId, 'stripe_webhook_secret'),
  ])
  return { secretKey, webhookSecret }
}

/**
 * Writes a secret. Upsert rather than insert: re-pasting a rotated key is the
 * normal case, and there is deliberately no way to read one back out.
 *
 * Also clears the legacy `accounts` column for that secret, so saving a new
 * value never leaves the old one sitting somewhere every staff member can
 * read -- otherwise rotating a key would quietly re-open the exposure.
 */
export async function setAccountSecret(
  supabase: SupabaseClient<Database>,
  accountId: string,
  name: AccountSecretName,
  value: string,
): Promise<void> {
  const { error } = await supabase
    .from('account_secrets')
    .upsert({ account_id: accountId, name, value, updated_at: new Date().toISOString() }, { onConflict: 'account_id,name' })
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })

  await supabase
    .from('accounts')
    .update({ [name]: null } as never)
    .eq('id', accountId)
}

/** Which secrets are set, for a settings page that must never see the values. */
export async function accountSecretStatus(supabase: SupabaseClient<Database>, accountId: string) {
  const [secretKey, webhookSecret] = await Promise.all([
    getAccountSecret(supabase, accountId, 'stripe_secret_key'),
    getAccountSecret(supabase, accountId, 'stripe_webhook_secret'),
  ])
  return { stripeSecretKey: Boolean(secretKey), stripeWebhookSecret: Boolean(webhookSecret) }
}
