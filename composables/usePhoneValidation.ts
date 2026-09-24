import { looksLikePhoneNumber, splitDialPrefix } from '~/utils/phone'

// The message a staff-side phone field shows for something that is not a
// phone number, or '' when there is nothing to say.
//
// utils/phone.ts holds the rule; this holds the wording, because the rule is
// also restated in SQL inside create_public_booking and a translated string
// has no business there. Four fields write patient_contact_numbers -- this
// editor, AddPatientModal, NewAppointmentPanel and the public booking form --
// and until now only the booking form checked what it was given. Reception
// typing for a patient standing at the desk is a smaller risk than an
// unattended public form, but it is not no risk: the number is what every
// recall, reminder and WhatsApp thread is addressed to afterwards.
//
// The public booking form deliberately does NOT use this. It is patient-facing
// and Spanish-only by design, with no t() anywhere on the page; it shares the
// rule, not the words.
export function usePhoneValidation() {
  const t = useT()

  /**
   * Blank is not a problem here. Every staff-side phone field is optional --
   * a patient record without a number is a real thing, and a walk-in who
   * will not give one still needs to exist. The rule is "if you typed
   * something, it has to be a number", not "you must type one".
   */
  function phoneProblem(input: string, countryCode: string): string {
    if (!input.trim()) return ''
    if (looksLikePhoneNumber(input, countryCode)) return ''
    // Named for the country the NUMBER resolves to, the same one the rule
    // judged it by, so a pasted "+44…" is never told it needs nine digits.
    const { countryCode: resolved } = splitDialPrefix(input.trim(), countryCode)
    return resolved === 'ES'
      ? t('A Spanish number has 9 digits.', 'Un número español tiene 9 dígitos.')
      : t('That number looks incomplete.', 'Ese número parece incompleto.')
  }

  return { phoneProblem }
}
