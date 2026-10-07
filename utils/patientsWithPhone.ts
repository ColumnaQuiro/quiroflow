import { fetchAllRows } from '../composables/useFetchAllRows'
import { phoneMatches } from './phone'

/**
 * The patients of an account with a contact number matching `incomingE164`
 * (bare digits, as phoneMatches takes them).
 *
 * Every number is read, page by page. The match runs in JS -- phoneMatches
 * tolerates a missing or wrong country code, which no SQL filter on the column
 * reproduces -- so the whole account's numbers have to come back, and an
 * unpaged select stops at 1000 rows without an error. Columnaquiro had 1,560
 * on 3 Oct 2026: about 560 patients could never match by phone, so the public
 * lookup called them "not converted" and the lead drip kept messaging them.
 *
 * Ordered by id so the pages neither overlap nor skip a row. A failed read
 * throws rather than returning nothing -- "no match" is the answer that sends
 * the next drip message.
 */
export async function patientsWithPhone(supabase: any, accountId: string, incomingE164: string): Promise<Set<string>> {
  const matched = new Set<string>()
  if (!incomingE164) return matched

  const numbers = await fetchAllRows<{ patient_id: string; number: string; country_code: string }>((from, to) =>
    supabase.from('patient_contact_numbers').select('patient_id, number, country_code').eq('account_id', accountId).order('id').range(from, to),
  )
  for (const n of numbers) {
    if (phoneMatches(n.number, n.country_code, incomingE164)) matched.add(n.patient_id)
  }
  return matched
}
