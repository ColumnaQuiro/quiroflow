import type { Json } from '~/types/database.types'
import { serviceSupabase } from './serviceSupabase'
import { deliverEmail } from './resend'

// Facts about QuiroFlow's own providers (platform_status), and the email that
// tells whoever runs the platform when one of them is about to stop working:
// the Anthropic credit running out stops the AI receptionist for every clinic
// at once, and nothing on any clinic's screen says why.
//
// Everything here is best-effort. It runs inside a send or a model call that
// has already succeeded or failed on its own terms, and a status table that
// cannot be written must never turn either into a different outcome.

export async function writePlatformStatus(key: string, value: Json): Promise<void> {
  const service = serviceSupabase()
  if (!service) return
  const { error } = await service.from('platform_status').upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) console.error(`[platform-status] could not write ${key}`, error.message)
}

export async function readPlatformStatus<T = Record<string, unknown>>(key: string): Promise<T | null> {
  const service = serviceSupabase()
  if (!service) return null
  const { data } = await service.from('platform_status').select('value').eq('key', key).maybeSingle()
  return (data?.value as T | undefined) ?? null
}

/**
 * Emails NUXT_OPS_ALERT_EMAIL (or, unset, the sign-up notification address)
 * at most once per `everyHours` for the same `name`.
 *
 * The send is recorded BEFORE it is attempted. An alert about email quota
 * goes out through the same email path, and recording first is what stops
 * that path from alerting about itself in a loop; the cost is that a failed
 * alert is not retried until the window passes.
 */
export async function alertOps(name: string, subject: string, lines: string[], everyHours = 6): Promise<void> {
  try {
    const config = useRuntimeConfig()
    const to = (config.opsAlertEmail as string) || (config.signupNotifyEmail as string)
    if (!to) return

    const key = `alert:${name}`
    const last = await readPlatformStatus<{ sent_at?: string }>(key)
    if (last?.sent_at && Date.now() - new Date(last.sent_at).getTime() < everyHours * 3600_000) return
    await writePlatformStatus(key, { sent_at: new Date().toISOString(), subject })

    const html = lines.map((l) => `<p style="margin:0 0 10px;font-size:14px;color:#15171E">${l}</p>`).join('')
    await deliverEmail({ to, subject: `[QuiroFlow] ${subject}`, html })
  } catch (e: any) {
    console.error(`[ops-alert] ${name} could not be sent`, e?.message ?? e)
  }
}
