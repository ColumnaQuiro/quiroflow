import { formatEur } from './billing'
export type BonoTone = 'success' | 'danger' | 'warning' | null

export interface BonoActivePackage {
  sessionsTotal: number
  sessionsUsed: number
  priceCents: number
}

export interface BonoStatusInput {
  balanceCents: number
  activePackage: BonoActivePackage | null
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
// renewal now. Red: the package is exhausted. Falls back to the plain
// account balance when the patient has no active package at all.
//
// The appointment type's own price is deliberately not consulted. There
// used to be a red "this visit costs more than the package covers --
// patient owes the difference" for a type priced above the bono's average
// session, which was true when a bono visit was billed at the walk-in price
// and the bono only defrayed part of it. It is not true now: taking the
// visit from a bono charges the BONO's per-session rate
// (AppointmentBillingTab.usePackageSession), so there is no difference to
// owe. Marta Abril's Ajuste Quiropractico read as a debt on a 55 EUR type
// against her 40 EUR bono while she was 160 EUR in credit -- three ways of
// being wrong about the same visit.
export function computeBonoStatus({ balanceCents, activePackage }: BonoStatusInput): BonoStatus {
  if (activePackage) {
    const sessionsRemainingBefore = activePackage.sessionsTotal - activePackage.sessionsUsed
    if (sessionsRemainingBefore <= 0) {
      return { tone: 'danger', label: 'Package exhausted — patient needs to pay for this visit' }
    }
    // The rate the visit will actually be charged at -- the same rounding
    // usePackageSession bills it with, so the badge and the charge agree.
    // Stated outright because it is the answer to the question the old red
    // banner got wrong: what this visit costs is the bono's rate, not the
    // appointment type's.
    const perSessionCents = Math.round(activePackage.priceCents / activePackage.sessionsTotal)
    const rate = formatEur(perSessionCents)
    if (sessionsRemainingBefore === 1) {
      return { tone: 'warning', label: `Last session covered by the package, at ${rate} — offer a renewal now for next time` }
    }
    const leftAfter = sessionsRemainingBefore - 1
    return { tone: 'success', label: `Covered by package at ${rate} (${leftAfter} session${leftAfter === 1 ? '' : 's'} left after this one)` }
  }
  if (balanceCents > 0) return { tone: 'success', label: `Patient has ${formatEur(balanceCents)} credit on account` }
  if (balanceCents < 0) return { tone: 'danger', label: `Patient owes ${formatEur(Math.abs(balanceCents))} — will need to pay` }
  return { tone: null, label: '' }
}
