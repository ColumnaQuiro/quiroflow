// Whose income is this payment?
//
// The chain was payment -> invoice -> appointment -> practitioner, and any
// payment off that chain belonged to nobody. In September that was 9,057 EUR
// of the clinic's 9,976: filtering income by Beatriz Ferrando showed 849 EUR,
// and the rest simply vanished rather than being counted anywhere.
//
// Three kinds of money have no appointment behind them by design:
//
//   - a bono payment. A bono is not a visit, and since the sale stopped
//     raising an invoice it has no invoice either.
//   - money put on account, which is paid before anyone knows what it buys.
//   - a quick invoice raised without an appointment.
//
// So where there is no appointment, the patient's own practitioner answers
// instead. That field was empty on 1,381 of 1,559 patients until it was
// backfilled from visit history; it is what makes this fallback resolve.
//
// It is an attribution, not a measurement: a bono sold by one practitioner to
// another's patient counts to the patient's. Following the money to the
// sessions as they are actually used is the exact version, and a much larger
// change. Anything this cannot place is reported as unattributed rather than
// dropped, so a filtered total still reconciles with the clinic's takings.

export interface IncomeFilterInput {
  practitionerId?: string
  clinicId?: string
  /** The appointment behind the payment, when there is one. */
  appointment: { practitioner_id: string | null; clinic_id: string | null } | null
  /** The patient it was taken from -- the fallback when there is no appointment. */
  patient: { default_practitioner_id: string | null; clinic_id: string | null } | null
}

export type IncomeMatch = 'matches' | 'excluded' | 'unattributable'

/**
 * `matches` -- counts towards the filtered total.
 * `excluded` -- belongs to someone else, and is correctly left out.
 * `unattributable` -- nothing on it says whose it is. Usually a PracticeHub
 *   payment imported unallocated, which PracticeHub never attributed either.
 */
export function classifyPaymentForFilter(input: IncomeFilterInput): IncomeMatch {
  if (!input.practitionerId && !input.clinicId) return 'matches'

  if (input.appointment) {
    if (input.practitionerId && input.appointment.practitioner_id !== input.practitionerId) return 'excluded'
    if (input.clinicId && input.appointment.clinic_id !== input.clinicId) return 'excluded'
    return 'matches'
  }

  // No appointment: fall back to the patient. A patient with no practitioner
  // of their own cannot be placed -- saying "excluded" would quietly claim it
  // belongs to somebody else.
  if (input.practitionerId) {
    if (!input.patient?.default_practitioner_id) return 'unattributable'
    if (input.patient.default_practitioner_id !== input.practitionerId) return 'excluded'
  }
  if (input.clinicId) {
    if (!input.patient?.clinic_id) return 'unattributable'
    if (input.patient.clinic_id !== input.clinicId) return 'excluded'
  }
  return 'matches'
}

export function paymentMatchesFilter(input: IncomeFilterInput): boolean {
  return classifyPaymentForFilter(input) === 'matches'
}

/**
 * Whose income this payment is, as a practitioner id -- the same chain
 * classifyPaymentForFilter applies, for the screens that GROUP by
 * practitioner rather than filter to one.
 *
 * Splitting those two apart is what let them drift. The filter was taught the
 * patient fallback; the Income report's own by-practitioner breakdown was
 * not, and went on reading payment -> invoice -> appointment alone. So
 * filtering to a practitioner counted a bono of theirs while the breakdown
 * beside it still called the same euros "Sin asignar" -- 13,164 EUR of
 * September 2026's 16,711, with only 301 EUR genuinely unplaceable.
 *
 * null means exactly that: nothing on the payment says whose it is. It is a
 * bucket to report, never a practitioner to invent.
 */
export function practitionerForPayment(input: Pick<IncomeFilterInput, 'appointment' | 'patient'>): string | null {
  // A visit is the end of the chain even when it names no practitioner --
  // 200 appointments here do not. Falling through to the patient in that case
  // would answer differently from classifyPaymentForFilter above, which
  // compares the appointment's practitioner and stops there, so the same
  // euros would be counted to someone the filter excludes them from.
  if (input.appointment) return input.appointment.practitioner_id
  return input.patient?.default_practitioner_id ?? null
}
