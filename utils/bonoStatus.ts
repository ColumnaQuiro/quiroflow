export type BonoTone = 'success' | 'danger' | 'warning' | null

export interface BonoActivePackage {
  sessionsTotal: number
  sessionsUsed: number
  priceCents: number
}

export interface BonoStatusInput {
  balanceCents: number
  activePackage: BonoActivePackage | null
  appointmentPriceCents: number
}

export interface BonoStatus {
  tone: BonoTone
  label: string
}

// Shared by the calendar grid's balance icon, the appointment hover card,
// and the appointment edit modal, so the green/yellow/red call is
// identical everywhere instead of drifting between three copies of the
// same thresholds.
//
// Green: an active package (bono) covers this visit with sessions left
// over afterwards. Yellow: this visit uses the package's last covered
// session -- next time the patient will need to pay, so staff can offer a
// renewal now. Red: the package is exhausted, or this appointment type
// costs more than the package's average per-session value, so the patient
// will owe money on top of it. Falls back to the plain account balance
// when the patient has no active package at all.
export function computeBonoStatus({ balanceCents, activePackage, appointmentPriceCents }: BonoStatusInput): BonoStatus {
  if (activePackage) {
    const sessionsRemainingBefore = activePackage.sessionsTotal - activePackage.sessionsUsed
    if (sessionsRemainingBefore <= 0) {
      return { tone: 'danger', label: 'Package exhausted — patient needs to pay for this visit' }
    }
    const perSessionCents = activePackage.priceCents / activePackage.sessionsTotal
    if (appointmentPriceCents > perSessionCents) {
      return { tone: 'danger', label: 'This visit costs more than the package covers — patient owes the difference' }
    }
    if (sessionsRemainingBefore === 1) {
      return { tone: 'warning', label: 'Last session covered by the package — offer a renewal now for next time' }
    }
    const leftAfter = sessionsRemainingBefore - 1
    return { tone: 'success', label: `Covered by package (${leftAfter} session${leftAfter === 1 ? '' : 's'} left after this one)` }
  }
  if (balanceCents > 0) return { tone: 'success', label: `Patient has €${(balanceCents / 100).toFixed(2)} credit on account` }
  if (balanceCents < 0) return { tone: 'danger', label: `Patient owes €${(Math.abs(balanceCents) / 100).toFixed(2)} — will need to pay` }
  return { tone: null, label: '' }
}
