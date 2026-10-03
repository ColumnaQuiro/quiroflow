import { patientsWithPhone } from './patientsWithPhone'

/**
 * Who a WhatsApp message to `to` (bare digits) would reach, and whether any of
 * them must not be messaged.
 *
 * The public send resolves a number to a patient for one reason that matters:
 * to refuse minors and patients marked do-not-contact. It used to read the
 * account's contact numbers with an unpaged select, which PostgREST stops at
 * 1000 rows without an error -- Columnaquiro had 1,560 on 3 Oct 2026, so about
 * 560 patients resolved to nobody and a send to them skipped the refusal.
 * patientsWithPhone reads every page.
 *
 * It matches with phoneMatches, not the exact toE164() comparison this used
 * before. That is looser on purpose: a number stored with its dial code, or
 * under the wrong country, is still that person's phone, and for a refusal a
 * false match costs an error the caller can see while a missed one sends a
 * message to someone who asked not to get any.
 *
 * Every patient the number reaches is checked, not just the first. Families
 * share phones (93 numbers at Columnaquiro on 3 Oct 2026), and a message to a
 * shared number reaches all of them. A caller who means the adult on a phone
 * shared with a minor can name them with patient_id, which skips this.
 *
 * A failed read throws. "Nobody matched" is the answer that sends.
 */
export async function whatsappRecipient(supabase: any, accountId: string, to: string): Promise<{ patientId: string | null; blocked: boolean }> {
  const ids = [...(await patientsWithPhone(supabase, accountId, to))]
  if (ids.length === 0) return { patientId: null, blocked: false }

  const { data: patients, error } = await supabase.from('patients').select('id, is_minor, do_not_contact').eq('account_id', accountId).in('id', ids)
  if (error) throw error
  const blocked = (patients ?? []).some((p: { is_minor: boolean | null; do_not_contact: boolean | null }) => p.is_minor || p.do_not_contact)

  // The message row can name one patient. The first match, as the inbound
  // webhook attributes a shared number.
  return { patientId: ids[0], blocked }
}
