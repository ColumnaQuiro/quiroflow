import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// Confirms that a GoCardless mandate is this patient's. The mandate is read
// from GoCardless again rather than trusted from the page: what is stored is
// what GoCardless says now, and a mandate id from another organisation is
// refused because it is not found there.
export default defineEventHandler(async (event) => {
  const { teamMember } = await requirePermission(event, 'billing_config')
  const body = await readBody<{ mandateId?: string; patientId?: string; matchedBy?: 'email' | 'phone' | 'name' | 'manual' }>(event)
  if (!body?.mandateId || !body?.patientId) throw createError({ statusCode: 400, statusMessage: 'mandateId and patientId are required' })

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: patient } = await admin.from('patients').select('id').eq('id', body.patientId).eq('account_id', teamMember.account_id).maybeSingle()
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  const request = await gocardlessForAccount(admin, teamMember.account_id)
  if (!request) throw createError({ statusCode: 409, statusMessage: 'GoCardless is not connected' })

  let mandate: GcMandate
  let bank: GcCustomerBankAccount | null = null
  try {
    ;({ mandates: mandate } = await request<{ mandates: GcMandate }>('GET', `/mandates/${encodeURIComponent(body.mandateId)}`))
    bank = (await request<{ customer_bank_accounts: GcCustomerBankAccount }>('GET', `/customer_bank_accounts/${mandate.links.customer_bank_account}`)).customer_bank_accounts
  } catch (err) {
    if (err instanceof GoCardlessError && err.status === 404) throw createError({ statusCode: 404, statusMessage: 'Mandate not found in this GoCardless account' })
    throw createError({ statusCode: 502, statusMessage: (err as Error).message })
  }

  const { error } = await admin.from('patient_gocardless_mandates').upsert(
    {
      account_id: teamMember.account_id,
      patient_id: patient.id,
      gocardless_mandate_id: mandate.id,
      gocardless_customer_id: mandate.links.customer,
      status: mandate.status,
      scheme: mandate.scheme,
      bank_name: bank?.bank_name ?? null,
      account_number_ending: bank?.account_number_ending ?? null,
      origin: 'imported',
      matched_by: body.matchedBy ?? 'manual',
      matched_at: new Date().toISOString(),
      matched_by_member: teamMember.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,gocardless_mandate_id' },
  )
  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { ok: true }
})
