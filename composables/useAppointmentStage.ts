import type { AppointmentStage, StageFilter } from '~/utils/appointmentStage'
import { formatShortDate, formatTime } from '~/utils/billing'

// The words and tones for each stage, in one place, so the block, the counts
// row, the hover card and the appointment panel say the same thing about the
// same visit. The rules that PICK the stage live in utils/appointmentStage.

/**
 * Tone of a stage's label. There is no red here on purpose: red on the
 * calendar means money and nothing else, so a no-show is marked by its
 * struck-through name and striped fill rather than by colour.
 */
export type StageTone = 'warning' | 'warningStrong' | 'muted' | 'success' | 'info'

export const STAGE_TONE: Record<AppointmentStage, StageTone> = {
  pending: 'warning',
  online: 'warning',
  resched: 'warningStrong',
  confirmed: 'muted',
  arrived: 'success',
  withp: 'info',
  checkout: 'warningStrong',
  completed: 'muted',
  noshow: 'muted',
  cancelled: 'muted',
}

/** Tailwind classes for a stage label, as the block and the panel draw it. */
export const STAGE_TONE_CLASS: Record<StageTone, string> = {
  warning: 'text-warning-text',
  warningStrong: 'text-warning-text bg-warning-bg border border-warning-border',
  muted: 'text-ink-muted',
  success: 'text-success-text bg-success-bg border border-success-border',
  info: 'text-info-text bg-info-bg border border-info-border',
}

/** The dot beside each counts-row chip. */
export const FILTER_DOT_CLASS: Record<StageFilter, string> = {
  pending: 'bg-warning-accent',
  resched: 'bg-warning-accent',
  arrived: 'bg-success-accent',
  withp: 'bg-info-accent',
  checkout: 'bg-warning-accent',
  owes: 'bg-danger-text',
}

export function useStageLabels() {
  const t = useT()

  /** The short label a block's pill prints. `arrivedAt` is "17:36". */
  function stageLabel(stage: AppointmentStage, arrivedAt?: string | null): string {
    switch (stage) {
      case 'pending':
        return t('Unconfirmed', 'Sin confirmar')
      case 'online':
        return t('Online · unconfirmed', 'Online · sin confirmar')
      case 'resched':
        return t('Wants to move', 'Quiere cambiar')
      case 'confirmed':
        return t('Confirmed', 'Confirmada')
      case 'arrived':
        return arrivedAt ? t(`Arrived ${arrivedAt}`, `Llegó ${arrivedAt}`) : t('Arrived', 'Llegó')
      case 'withp':
        return t('In session', 'En consulta')
      case 'checkout':
        return t('To pay', 'Por cobrar')
      case 'completed':
        return t('Done', 'Hecha')
      case 'noshow':
        return t('No-show', 'No vino')
      case 'cancelled':
        return t('Cancelled', 'Cancelada')
    }
  }

  /** The counts row's chip text, after the number. */
  function filterLabel(filter: StageFilter): string {
    switch (filter) {
      case 'pending':
        return t('unconfirmed', 'sin confirmar')
      case 'resched':
        return t('want to move', 'quieren cambiar')
      case 'arrived':
        return t('waiting', 'esperando')
      case 'withp':
        return t('in session', 'en consulta')
      case 'checkout':
        return t('to pay', 'por cobrar')
      case 'owes':
        return t('owe', 'deben')
    }
  }

  /** "hoy 10:00", or "16 sept 10:00" on any other day. */
  function when(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    return `${sameDay ? t('today', 'hoy') : formatShortDate(d)} ${formatTime(d)}`
  }

  /**
   * The sentence the hover card and the panel print for a stage: a headline,
   * and the one detail that explains it ("Recordatorio enviado hoy 10:00 ·
   * sin respuesta", "había confirmado").
   */
  function stageLine(a: StageFacts, stage: AppointmentStage): { title: string; sub: string | null } {
    const lastMessage = [a.reminder_sent_at, a.confirmation_sent_at].filter((x): x is string => !!x).sort().pop() ?? null
    switch (stage) {
      case 'pending':
        return {
          title: t('Unconfirmed', 'Sin confirmar'),
          sub: lastMessage
            ? a.reminder_sent_at === lastMessage
              ? t(`Reminder sent ${when(lastMessage)} · no reply`, `Recordatorio enviado ${when(lastMessage)} · sin respuesta`)
              : t(`Confirmation sent ${when(lastMessage)} · no reply`, `Confirmación enviada ${when(lastMessage)} · sin respuesta`)
            : null,
        }
      case 'online':
        return { title: t('Booked online · unconfirmed', 'Reservada online · sin confirmar'), sub: lastMessage ? t(`Message sent ${when(lastMessage)}`, `Mensaje enviado ${when(lastMessage)}`) : null }
      case 'resched':
        return { title: t('Wants to move it', 'Quiere cambiar la cita'), sub: t('Asked in reply to our message', 'Lo pidió al responder a nuestro mensaje') }
      case 'confirmed':
        return { title: t('Confirmed', 'Confirmada'), sub: null }
      case 'arrived':
        return {
          title: t(`Arrived at ${formatTime(a.checked_in_at!)}`, `Llegó a las ${formatTime(a.checked_in_at!)}`),
          sub: a.confirmation_status === 'confirmed' ? t('had confirmed', 'había confirmado') : null,
        }
      case 'withp':
        return { title: t(`In session since ${formatTime(a.flow_with_practitioner_at!)}`, `En consulta desde las ${formatTime(a.flow_with_practitioner_at!)}`), sub: null }
      case 'checkout':
        return { title: t(`To pay since ${formatTime(a.flow_checkout_at!)}`, `Por cobrar desde las ${formatTime(a.flow_checkout_at!)}`), sub: null }
      default:
        return { title: stageLabel(stage), sub: null }
    }
  }

  return { stageLabel, filterLabel, stageLine, when }
}

/** What stageLine reads off the appointment row. */
export interface StageFacts {
  confirmation_status: string | null
  checked_in_at: string | null
  flow_with_practitioner_at: string | null
  flow_checkout_at: string | null
  confirmation_sent_at: string | null
  reminder_sent_at: string | null
}
