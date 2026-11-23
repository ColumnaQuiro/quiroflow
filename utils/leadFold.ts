import { phoneMatches } from './phone'

// One person, one lead, when an ad form ends in WhatsApp.
//
// A Meta lead form can finish by opening WhatsApp with the answers already
// typed, so the person's first act is a message. That message reaches the
// WhatsApp webhook at once and becomes a lead (whatsappLeads.ts), which the
// receptionist starts answering. The form itself arrives minutes later
// through the leadgen webhook -- 2 to 35 minutes, on the first four (21-23
// Nov 2026) -- and was deduplicated only on Meta's lead id, which the
// WhatsApp lead does not carry. So it became a second lead with the same
// number, and that one started the clinic's welcome drip.
//
// Each lead had its own conversation and neither saw the other's: the drip
// welcomed somebody the receptionist had already offered times to, the
// receptionist nudged somebody who had already booked on the other lead, and
// quoted the full price because nothing on its lead said "came from the ad".
//
// So a form whose number matches a WhatsApp lead that wrote in recently is
// filed onto that lead instead.

/** How recent a WhatsApp lead must be for a form to be the same enquiry. */
export const FOLD_WINDOW_DAYS = 7

export interface FoldCandidate {
  id: string
  phone: string | null
  stage: string
  patient_id: string | null
  external_source: string | null
  created_at: string
}

/**
 * The WhatsApp lead this form submission belongs to, or null to file a new
 * lead. The newest that matches: started by a WhatsApp message, the same
 * number, written in within the window, and still an open enquiry -- one
 * that became a patient or was marked lost is history, and a new form from
 * that person is a new enquiry.
 */
export function whatsAppLeadToFoldInto<T extends FoldCandidate>(candidates: T[], formPhone: string | null | undefined, now = new Date()): T | null {
  const digits = (formPhone ?? '').replace(/\D/g, '')
  if (!digits) return null
  const since = now.getTime() - FOLD_WINDOW_DAYS * 86_400_000
  const open = candidates
    .filter((c) => c.external_source === 'whatsapp')
    .filter((c) => !c.patient_id && c.stage !== 'converted' && c.stage !== 'lost')
    .filter((c) => new Date(c.created_at).getTime() >= since)
    .filter((c) => c.phone && phoneMatches(c.phone, 'ES', digits))
  open.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return open[0] ?? null
}
