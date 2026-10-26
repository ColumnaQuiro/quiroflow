import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { sendResendEmail } from '~/server/utils/resend'
import { accountSenderConfig } from '~/server/utils/verifactuSender'
import {
  type UnacceptedRecord,
  verifactuCertificateAlertEmail,
  verifactuCertificateAlertKey,
  verifactuRecordsAlertEmail,
  verifactuRecordsToAlert,
} from '~/utils/verifactuAlerts'

// Tells the people who can act when VeriFactu is not working: an email to the
// clinic's owners and an event in Sentry. Run by verifactu-cron after it has
// sent, so a record the tick just got accepted is not reported.
//
// Before this, an unaccepted record showed in the cron's JSON response and in
// Settings > VeriFactu, and nowhere a person would see it unprompted. Under
// VERI*FACTU a record nobody is sending looks exactly like a quiet day.
//
// Each alert is sent once (verifactu_alerts). The row is claimed BEFORE the
// email goes: a failed email then means one missed alert, not one a minute.
// Sentry still gets every one, so a missed email is not a missed alert.

const SETTINGS_URL = 'https://app.quiroflow.com/settings/verifactu'

type Service = SupabaseClient<Database>

/** Claims alert keys; returns the ones this call won. */
async function claim(supabase: Service, accountId: string, kind: 'record' | 'certificate', keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set()
  const { data, error } = await supabase
    .from('verifactu_alerts')
    .upsert(keys.map((key) => ({ account_id: accountId, kind, key })), { onConflict: 'account_id,kind,key', ignoreDuplicates: true })
    .select('key')
  if (error) throw new Error(`verifactu_alerts: ${error.message}`)
  return new Set((data ?? []).map((r) => r.key))
}

/** Owners' emails. A delegated clinic's alerts also go to the platform's owners, whose certificate is the one sending. */
async function recipients(supabase: Service, accountIds: string[]): Promise<string[]> {
  const { data: owners } = await supabase
    .from('team_members')
    .select('user_id')
    .in('account_id', accountIds)
    .eq('is_owner', true)
    .is('deleted_at', null)
    .not('user_id', 'is', null)
  const userIds = [...new Set((owners ?? []).map((o) => o.user_id as string))]
  const emails: string[] = []
  for (const id of userIds) {
    const { data } = await supabase.auth.admin.getUserById(id)
    if (data?.user?.email) emails.push(data.user.email)
  }
  return [...new Set(emails)]
}

async function clinicName(supabase: Service, accountId: string): Promise<string> {
  const { data } = await supabase.from('accounts').select('name').eq('id', accountId).maybeSingle()
  return data?.name || 'tu clínica'
}

async function report(message: string, context: { accountId: string; fingerprint: string[]; extra: Record<string, unknown> }) {
  // Loaded here, not at the top: server/utils is evaluated on every cold
  // start (CLAUDE.md), and only a tick with something to report needs it.
  const Sentry = await import('@sentry/nuxt')
  Sentry.captureMessage(message, {
    level: 'error',
    tags: { feature: 'verifactu', account_id: context.accountId },
    extra: context.extra,
    fingerprint: context.fingerprint,
  })
  // A serverless function can be frozen as soon as it returns.
  await Sentry.flush(2000)
}

async function emailAll(to: string[], mail: { subject: string; html: string }, errors: string[]) {
  for (const address of to) {
    try {
      await sendResendEmail({ to: address, ...mail })
    } catch (err) {
      errors.push(`email: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function platformAccountFor(supabase: Service, accountId: string): Promise<string | null> {
  const { data: account } = await supabase.from('accounts').select('verifactu_sender').eq('id', accountId).maybeSingle()
  if (!account?.verifactu_sender || account.verifactu_sender === 'own_certificate') return null
  const { data: platform } = await supabase.from('verifactu_platform').select('account_id').maybeSingle()
  return platform?.account_id && platform.account_id !== accountId ? platform.account_id : null
}

/** Records unaccepted for too long, for one clinic. */
async function alertRecords(supabase: Service, accountId: string, secretKey: string, now: Date, errors: string[]): Promise<number> {
  const sender = await accountSenderConfig(supabase, accountId, secretKey)
  // Off means the clinic is not using VeriFactu: nothing is owed to anyone.
  if (sender.mode === 'off') return 0

  const { data: owed } = await supabase.rpc('factura_records_awaiting_aeat', { p_account_id: accountId })
  if (!owed?.length) return 0

  const ids = owed.map((r) => r.factura_record_id)
  const [{ data: rows }, { data: alerted }, { data: answers }] = await Promise.all([
    supabase.from('factura_records').select('id, generated_at, environment').in('id', ids),
    supabase.from('verifactu_alerts').select('key').eq('account_id', accountId).eq('kind', 'record').in('key', ids),
    supabase.from('factura_record_submissions').select('factura_record_id, error_message, created_at').in('factura_record_id', ids).order('created_at', { ascending: false }),
  ])
  const recordById = new Map((rows ?? []).map((r) => [r.id, r]))
  const messageById = new Map<string, string | null>()
  for (const a of answers ?? []) if (!messageById.has(a.factura_record_id)) messageById.set(a.factura_record_id, a.error_message)

  const records: UnacceptedRecord[] = owed.flatMap((o) => {
    const r = recordById.get(o.factura_record_id)
    if (!r) return []
    return [{
      id: o.factura_record_id,
      serieNumber: o.serie_number,
      generatedAt: r.generated_at,
      environment: r.environment === 'production' ? 'production' as const : 'test' as const,
      lastStatus: o.last_status,
      lastErrorCode: o.last_error_code,
      lastErrorMessage: messageById.get(o.factura_record_id) ?? null,
      parked: o.parked,
    }]
  })

  const due = verifactuRecordsToAlert(records, new Set((alerted ?? []).map((a) => a.key)), now)
  if (!due.length) return 0
  const won = await claim(supabase, accountId, 'record', due.map((r) => r.id))
  const toSend = due.filter((r) => won.has(r.id))
  if (!toSend.length) return 0

  const name = await clinicName(supabase, accountId)
  const blocked = sender.blocked
  await report(`VeriFactu: ${toSend.length} record(s) not accepted by the AEAT after 15 minutes`, {
    accountId,
    fingerprint: ['verifactu-unaccepted', accountId],
    extra: { clinic: name, blocked, records: toSend.map((r) => ({ serie: r.serieNumber, environment: r.environment, status: r.lastStatus, code: r.lastErrorCode, message: r.lastErrorMessage, parked: r.parked })) },
  })

  const platform = await platformAccountFor(supabase, accountId)
  const to = await recipients(supabase, platform ? [accountId, platform] : [accountId])
  await emailAll(to, verifactuRecordsAlertEmail({ clinicName: name, records: toSend, blocked, settingsUrl: SETTINGS_URL }), errors)
  return toSend.length
}

/** Certificates about to expire, or expired. Owners of the account that holds the certificate. */
async function alertCertificates(supabase: Service, errors: string[]): Promise<number> {
  const { data: expiring } = await supabase.rpc('verifactu_certificates_expiring', { p_within_days: 30 })
  let sent = 0
  for (const c of expiring ?? []) {
    const key = verifactuCertificateAlertKey(c.not_after, c.days_left)
    if (!key) continue
    const won = await claim(supabase, c.account_id, 'certificate', [key])
    if (!won.has(key)) continue
    const name = await clinicName(supabase, c.account_id)
    await report(`VeriFactu: certificate ${c.days_left < 0 ? 'expired' : `expires in ${c.days_left} days`}`, {
      accountId: c.account_id,
      fingerprint: ['verifactu-certificate', c.account_id, key],
      extra: { clinic: name, notAfter: c.not_after, daysLeft: c.days_left },
    })
    await emailAll(
      await recipients(supabase, [c.account_id]),
      verifactuCertificateAlertEmail({ clinicName: name, subject: c.subject, notAfter: c.not_after, daysLeft: c.days_left, settingsUrl: SETTINGS_URL }),
      errors,
    )
    sent++
  }
  return sent
}

/**
 * Everything worth telling someone about, for every clinic that owes the AEAT
 * something. Never throws: an alert that fails must not fail the tick that
 * sends the records.
 */
export async function sendVerifactuAlerts(
  supabase: Service,
  owingAccountIds: string[],
  secretKey: string,
  now = new Date(),
): Promise<{ records: number; certificates: number; errors?: string[] }> {
  const errors: string[] = []
  let records = 0
  let certificates = 0
  for (const accountId of owingAccountIds) {
    try {
      records += await alertRecords(supabase, accountId, secretKey, now, errors)
    } catch (err) {
      errors.push(`${accountId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  try {
    certificates = await alertCertificates(supabase, errors)
  } catch (err) {
    errors.push(`certificates: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { records, certificates, ...(errors.length ? { errors } : {}) }
}
