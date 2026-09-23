import type { AppointmentStage, StageFilter } from '~/utils/appointmentStage'

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

  return { stageLabel, filterLabel }
}
