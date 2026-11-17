import { randomUUID } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

// A direct-debit sign-up link for one patient, from their Money tab: a
// GoCardless Billing Request asking for a SEPA Core mandate, and a Billing
// Request Flow on it -- GoCardless's own hosted page, where the patient
// enters their IBAN and accepts the mandate. QuiroFlow never sees the bank
// details; GoCardless's partner rules forbid collecting them ourselves.
//
// The request is stored against the patient (gocardless_billing_requests),
// so when GoCardless reports it fulfilled the mandate is paired with exactly
// this patient (syncGoCardlessBillingRequest), not with whoever shares an
// email address.
//
// A link still open for this patient is handed back rather than a second one
// made: two live links for one person is two mandates if they open both.
// `fresh: true` closes the old one and makes a new one.
//
// Also returns the words to send it with, in the patient's language, for the
// existing email and WhatsApp senders (CLAUDE.md: what a clinic SENDS follows
// patients.preferred_language, not the interface).
export default defineEventHandler(async (event) => {
  const { supabase, teamMember } = await requirePermission(event, 'billing_config')
  const body = await readBody<{ patientId?: string; fresh?: boolean; attemptId?: string }>(event)
  if (!body?.patientId) throw createError({ statusCode: 400, statusMessage: 'patientId is required' })

  // Read through the caller's own client: a patient this member may not see
  // is "not found", the same answer as one that does not exist.
  const { data: patient } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email, address, postal_code, city, country, preferred_language, is_minor')
    .eq('id', body.patientId)
    .eq('account_id', teamMember.account_id)
    .maybeSingle()
  if (!patient) throw createError({ statusCode: 404, statusMessage: 'Patient not found' })

  const admin = serverSupabaseServiceRole<Database>(event)
  const request = await gocardlessForAccount(admin, teamMember.account_id)
  if (!request) throw createError({ statusCode: 409, statusMessage: 'GoCardless is not connected' })

  const { data: account } = await admin.from('accounts').select('name').eq('id', teamMember.account_id).maybeSingle()
  const lang: 'es' | 'en' = patient.preferred_language === 'en' ? 'en' : 'es'
  const message = (url: string) => linkMessage(lang, account?.name ?? '', url)

  const now = new Date().toISOString()
  const { data: open } = await admin
    .from('gocardless_billing_requests')
    .select('id, gocardless_billing_request_id, authorisation_url, expires_at')
    .eq('account_id', teamMember.account_id)
    .eq('patient_id', patient.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  for (const row of open ?? []) {
    const live = Boolean(row.authorisation_url) && (!row.expires_at || row.expires_at > now)
    if (live && !body.fresh) {
      return { url: row.authorisation_url!, expiresAt: row.expires_at, reused: true, ...message(row.authorisation_url!) }
    }
    // Replaced or lapsed: close it at GoCardless too, so the old link stops
    // working rather than producing a second mandate.
    if (live) {
      await request('POST', `/billing_requests/${encodeURIComponent(row.gocardless_billing_request_id)}/actions/cancel`).catch((e) =>
        console.error('[gocardless link] could not cancel the old request', row.gocardless_billing_request_id, (e as Error).message),
      )
    }
    await admin.from('gocardless_billing_requests').update({ status: live ? 'cancelled' : 'expired', updated_at: now }).eq('id', row.id)
  }

  const origin = getRequestURL(event).origin
  const attempt = body.attemptId || randomUUID()
  let billingRequest: GcBillingRequest
  let flow: GcBillingRequestFlow
  try {
    ;({ billing_requests: billingRequest } = await request<{ billing_requests: GcBillingRequest }>('POST', '/billing_requests', {
      idempotencyKey: `qf-brq-${patient.id}-${attempt}`,
      body: {
        billing_requests: {
          mandate_request: { scheme: 'sepa_core', currency: 'EUR' },
          // A second key to the patient beside our own row: what lets the
          // clinic see, in its GoCardless dashboard, who a mandate is for.
          metadata: { quiroflow_patient: patient.id },
        },
      },
    }))
    ;({ billing_request_flows: flow } = await request<{ billing_request_flows: GcBillingRequestFlow }>('POST', '/billing_request_flows', {
      idempotencyKey: `qf-brf-${billingRequest.id}`,
      body: {
        billing_request_flows: {
          redirect_uri: `${origin}/direct-debit-done`,
          exit_uri: `${origin}/direct-debit-done?status=cancelled`,
          language: lang,
          prefilled_customer: prefilledCustomer(patient),
          links: { billing_request: billingRequest.id },
        },
      },
    }))
  } catch (err) {
    if (err instanceof GoCardlessError && err.tokenGone) {
      await forgetGoCardlessConnection(admin, teamMember.account_id)
      throw createError({ statusCode: 409, statusMessage: 'GoCardless was disconnected from its own dashboard. Connect it again.' })
    }
    throw createError({ statusCode: 502, statusMessage: `GoCardless refused the sign-up link: ${(err as Error).message}` })
  }

  const { error } = await admin.from('gocardless_billing_requests').insert({
    account_id: teamMember.account_id,
    patient_id: patient.id,
    gocardless_billing_request_id: billingRequest.id,
    gocardless_flow_id: flow.id,
    authorisation_url: flow.authorisation_url,
    expires_at: flow.expires_at,
    created_by_member: teamMember.id,
  })
  if (error) {
    // A link nobody here knows about would produce a mandate nobody pairs.
    // Close it at GoCardless rather than hand it out.
    await request('POST', `/billing_requests/${billingRequest.id}/actions/cancel`).catch(() => {})
    throw createError({ statusCode: 500, statusMessage: error.message })
  }

  return { url: flow.authorisation_url, expiresAt: flow.expires_at, reused: false, ...message(flow.authorisation_url) }
})

/**
 * What GoCardless's page opens already filled in. Only what we have: an empty
 * field is left for the patient, a wrong one has to be noticed and fixed. A
 * minor's own name is not the payer's, so it is left out for them.
 */
function prefilledCustomer(patient: { first_name: string; last_name: string | null; email: string | null; address: string | null; postal_code: string | null; city: string | null; country: string | null; is_minor: boolean }) {
  const out: Record<string, string> = {}
  if (!patient.is_minor) {
    if (patient.first_name?.trim()) out.given_name = patient.first_name.trim()
    if (patient.last_name?.trim()) out.family_name = patient.last_name.trim()
  }
  if (patient.email?.trim()) out.email = patient.email.trim()
  if (patient.address?.trim()) out.address_line1 = patient.address.trim()
  if (patient.city?.trim()) out.city = patient.city.trim()
  if (patient.postal_code?.trim()) out.postal_code = patient.postal_code.trim()
  const country = countryCode(patient.country)
  if (country) out.country_code = country
  return out
}

/** patients.country is free text ("España", "ES", "Portugal"); GoCardless wants ISO 3166-1 alpha-2. Unknown → left for the patient. */
function countryCode(country: string | null): string | null {
  const c = (country ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (!c) return null
  if (/^[a-z]{2}$/.test(c)) return c.toUpperCase()
  const known: Record<string, string> = { espana: 'ES', spain: 'ES', portugal: 'PT', francia: 'FR', france: 'FR', alemania: 'DE', germany: 'DE', italia: 'IT', italy: 'IT', andorra: 'AD' }
  return known[c] ?? null
}

function linkMessage(lang: 'es' | 'en', clinic: string, url: string) {
  return lang === 'en'
    ? {
        subject: `Set up your direct debit${clinic ? ` with ${clinic}` : ''}`,
        text: `To pay by direct debit, please set it up here. It takes a minute, through GoCardless, our payment provider:\n${url}`,
      }
    : {
        subject: `Domiciliación bancaria${clinic ? ` con ${clinic}` : ''}`,
        text: `Para pagar por domiciliación bancaria, configúrala aquí. Es un minuto, a través de GoCardless, nuestro proveedor de pagos:\n${url}`,
      }
}
