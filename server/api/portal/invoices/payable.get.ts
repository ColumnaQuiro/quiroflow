import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Whether the signed-in patient's clinic takes card payments online, so the
// app offers "Pagar" only where pay-link.post.ts would go through. The
// Stripe keys live on accounts, which patients cannot read.
export default defineEventHandler(async (event) => {
  const { user } = await requireAuthedUser(event)
  const service = serverSupabaseServiceRole<Database>(event)
  const { data: patients } = await service.from('patients').select('account_id').eq('user_id', user.id)
  const accountIds = [...new Set((patients ?? []).map((p) => p.account_id))]
  if (accountIds.length === 0) return { enabled: false }
  const { data: accounts } = await service.from('accounts').select('id').in('id', accountIds).not('stripe_publishable_key', 'is', null)
  return { enabled: (accounts ?? []).length > 0 }
})
