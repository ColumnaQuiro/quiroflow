// The example patient a merge field is filled with when there is no real
// one: the email editor's preview (composables/useMergeSamples.ts) and
// "Send test to me" (server/api/automations/send-test.post.ts), which runs
// against the staff member instead of a patient and so has no appointment,
// invoice, review link or last visit behind it.
//
// A test used to send those as empty strings, and Meta refuses a template
// parameter that is empty -- "(#131008) Required parameter is missing" -- so
// the step failed in the test while working fine for a real patient. A
// clinic read that as their automation being broken (22 Nov 2026).

export const MERGE_FIELD_SAMPLES: Record<string, string> = {
  first_name: 'Lucía',
  last_name: 'García',
  email: 'lucia@ejemplo.com',
  next_appointment: 'jueves 16 de octubre, 10:00',
  appointment_date: 'jueves 16 de octubre',
  appointment_time: '10:00',
  google_review_link: 'https://g.page/r/ejemplo/review',
  satisfaction_link: 'https://app.quiroflow.com/valorar/ejemplo',
  form_link: 'https://app.quiroflow.com/doc/ejemplo',
  waitlist_claim_link: 'https://app.quiroflow.com/w/ejemplo',
  waitlist_slot_datetime: 'viernes 17, 18:30',
  earlier_slot_datetime: 'viernes 17, 18:30',
  earlier_visit_datetime: 'jueves 23, 10:00',
  invoice_number: 'F-2026-0142',
  invoice_amount_owed: '45,00 €',
  invoice_pay_link: 'https://app.quiroflow.com/api/pay/ejemplo',
  practitioner_first_name: 'Ana',
  appointment_practitioner_first_name: 'Ana',
  last_visit_month: 'julio',
  referred_first_name: 'Marta',
  clinic_phone: '+34 600 000 000',
}

// Only the ones that are words in a language rather than names or links.
const ENGLISH: Record<string, string> = {
  next_appointment: 'Thursday 16 October, 10:00',
  appointment_date: 'Thursday 16 October',
  waitlist_slot_datetime: 'Friday 17, 18:30',
  earlier_slot_datetime: 'Friday 17, 18:30',
  earlier_visit_datetime: 'Thursday 23, 10:00',
  invoice_amount_owed: '€45.00',
  last_visit_month: 'July',
}

/**
 * The example value of a merge field, in the language the message goes out
 * in. Never empty: a field with no example (a lead's answer to a question)
 * reads as its own key in brackets, which is what a preview shows too.
 */
export function mergeFieldSample(source: string, language?: string | null): string {
  if ((language ?? 'es').toLowerCase().startsWith('en') && ENGLISH[source]) return ENGLISH[source]
  return MERGE_FIELD_SAMPLES[source] ?? `[${source}]`
}
