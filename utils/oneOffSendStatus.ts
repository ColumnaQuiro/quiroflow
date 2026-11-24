import type { Translate } from './automationCatalog'
import { scheduledSendLabel } from './automationDescribe'

// Where a one-off send (a group checked once: trigger 'segment', schedule
// 'once') stands, for the Sends list and the send's own checklist:
//
//   draft      not switched on, and has not gone out -- nothing will be sent
//   scheduled  switched on, waiting for its date and time (schedule.starts_at)
//   sending    switched on and due, or gone out with people still on their
//              way through it (an email waiting for the day's quota, a capped
//              send carrying on tomorrow, a follow-up step)
//   paused     switched off after it started, with people still inside
//   sent       gone out, nobody left inside
//
// "Gone out" is segment_last_run_at: the engine's claim on the occurrence
// (automationEngine.enrolDueSegments), stamped once, before anyone is
// enrolled. It is also what keeps a send from going twice, so a send with it
// set never enrols again whatever its date says.

export type OneOffSendState = 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent'

export interface OneOffSendStatus {
  state: OneOffSendState
  /** When it is due ('scheduled', or a 'draft' with a date), or when it went out ('sent'). */
  at: string | null
}

export interface OneOffSendInput {
  enabled: boolean
  segment?: { schedule?: { kind?: string; starts_at?: string } | null } | null
  segment_last_run_at?: string | null
}

/**
 * `live`: runs still going (status 'running' -- not the failed ones, which a
 * person has to look at but which never finish on their own), and whether a
 * daily cap left people for another day.
 */
export function oneOffSendStatus(rule: OneOffSendInput, live: { running: number; carryingOver?: boolean }, now = new Date()): OneOffSendStatus {
  const startsAt = rule.segment?.schedule?.starts_at ?? null
  const future = !!startsAt && new Date(startsAt).getTime() > now.getTime()
  const wentOut = rule.segment_last_run_at ?? null

  if (!wentOut) {
    if (!rule.enabled) return { state: 'draft', at: future ? startsAt : null }
    return future ? { state: 'scheduled', at: startsAt } : { state: 'sending', at: null }
  }
  if (live.running > 0 || live.carryingOver) return { state: rule.enabled ? 'sending' : 'paused', at: null }
  return { state: 'sent', at: wentOut }
}

/** "Scheduled · 3 Dec, 10:00", "Sent · 3 Dec, 10:05": the status as a pill says it. */
export function oneOffSendLabel(status: OneOffSendStatus, t: Translate, timeZone?: string): string {
  const at = status.at ? scheduledSendLabel(status.at, t, timeZone) : null
  switch (status.state) {
    case 'draft':
      return t('Draft', 'Borrador')
    case 'scheduled':
      return at ? t(`Scheduled · ${at}`, `Programada · ${at}`) : t('Scheduled', 'Programada')
    case 'sending':
      return t('Sending', 'Enviando')
    case 'paused':
      return t('Paused', 'Pausada')
    case 'sent':
      return at ? t(`Sent · ${at}`, `Enviada · ${at}`) : t('Sent', 'Enviada')
  }
}

export const ONE_OFF_SEND_TONE: Record<OneOffSendState, 'brand' | 'success' | 'warning' | 'info' | 'neutral'> = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'brand',
  paused: 'warning',
  sent: 'success',
}
