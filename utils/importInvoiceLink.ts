import { clinicDateOf, DEFAULT_CLINIC_TIMEZONE } from './clinicClock'

// Which visit a PracticeHub invoice belongs to.
//
// PracticeHub says so itself -- each invoice carries the id of the
// appointment it was raised for -- and that is always tried first. It fails
// in two ways that both happened while Columnaquiro was dual-running:
//
//   - The visit was entered in QuiroFlow, not imported, so no appointment here
//     carries PracticeHub's id.
//   - Staff deleted the appointment in PracticeHub and re-created it to check
//     the patient out. The invoice names the NEW appointment; QuiroFlow had
//     imported the old one. One patient's 9 Sep visit is 9851 here
//     and invoice 7202 points at 9876.
//
// Either way the invoice arrived linked to nothing, and the visit read "Not
// charged" beside a paid invoice for it. So when the id finds nothing, the
// invoice goes to the patient's visit on the day it was raised -- but only
// when there is exactly one such visit that could have been charged, and only
// when no other invoice is reaching for the same one. Anything less certain
// stays unlinked, which is what it was before: a wrong link would show a
// payment against the wrong visit, and an absent one only shows none.

export interface LinkableInvoice {
  ref: string
  patientId: string
  /** PracticeHub's appointment id for this invoice, as it sent it. */
  phAppointmentId: string | null
  createdAt: string
}

export interface LinkableAppointment {
  id: string
  patientId: string
  externalReference: string | null
  startsAt: string
  status: string
  clinicId: string | null
}

/** A visit that could carry a charge. A cancelled or still-booked one did not happen. */
const CHARGEABLE = new Set(['completed', 'no_show'])

/**
 * The appointment id for each invoice ref that can be linked; refs absent
 * from the result stay unlinked.
 *
 * `invoicedAppointmentIds` are visits that already have an invoice here and
 * so are not free to take another by date.
 */
export function linkInvoicesToAppointments(
  invoices: LinkableInvoice[],
  appointments: LinkableAppointment[],
  invoicedAppointmentIds: Set<string>,
  timezoneOfClinic: (clinicId: string | null) => string | null | undefined = () => DEFAULT_CLINIC_TIMEZONE,
): Map<string, string> {
  const links = new Map<string, string>()
  const taken = new Set(invoicedAppointmentIds)

  const byRef = new Map<string, LinkableAppointment>()
  for (const a of appointments) if (a.externalReference) byRef.set(a.externalReference, a)

  // PracticeHub's own link first, and for every invoice before any date
  // match, so a fallback can never take a visit that an invoice names outright.
  const unmatched: LinkableInvoice[] = []
  for (const inv of invoices) {
    const direct = inv.phAppointmentId ? byRef.get(inv.phAppointmentId) : undefined
    if (direct) {
      links.set(inv.ref, direct.id)
      taken.add(direct.id)
    } else {
      unmatched.push(inv)
    }
  }

  const tzOf = (clinicId: string | null) => timezoneOfClinic(clinicId) || DEFAULT_CLINIC_TIMEZONE
  const chargeableByPatient = new Map<string, LinkableAppointment[]>()
  for (const a of appointments) {
    if (!CHARGEABLE.has(a.status)) continue
    const list = chargeableByPatient.get(a.patientId) ?? []
    list.push(a)
    chargeableByPatient.set(a.patientId, list)
  }

  const claims = new Map<string, string[]>()
  for (const inv of unmatched) {
    // Both dates read at the visit's own clinic: an invoice raised at 00:30
    // is the previous evening's visit in Madrid, not the next day's in UTC.
    const free = (chargeableByPatient.get(inv.patientId) ?? []).filter((a) => {
      if (taken.has(a.id)) return false
      const tz = tzOf(a.clinicId)
      return clinicDateOf(new Date(a.startsAt), tz) === clinicDateOf(new Date(inv.createdAt), tz)
    })
    if (free.length !== 1) continue
    const claimants = claims.get(free[0]!.id) ?? []
    claimants.push(inv.ref)
    claims.set(free[0]!.id, claimants)
  }

  // Two invoices reaching for one visit is a day that cannot be read by date
  // alone -- a visit and a product sale, or two visits one of which is
  // missing here. Neither is linked.
  for (const [appointmentId, refs] of claims) {
    if (refs.length === 1) links.set(refs[0]!, appointmentId)
  }
  return links
}
