// What a payment was FOR, as opposed to how it arrived (usePaymentMethods).
//
// payments.purpose has been written since the ledger was built and displayed
// nowhere, which is how two card payments of 55 EUR taken 34 seconds apart on
// 15 Sep 2026 came to look like a double charge. They were not: one settled
// that day's visit, the other went on account and paid the visit two days
// later. The day sheet had the column in the row it was reading and never
// showed it.
//
// A shared labeller rather than a map per screen, for the reason
// usePaymentMethods was made one: there were six hardcoded method lists in
// four files and they had already drifted.
//
// The keys are the ones BillingTab writes -- 'visit', 'bono', 'membership',
// 'on_account'. Null is the ordinary case for anything older: every payment
// imported from PracticeHub has no purpose, and inventing one for it would be
// a claim nobody made.
const LABELS: Record<string, { en: string; es: string }> = {
  visit: { en: 'Visit', es: 'Visita' },
  bono: { en: 'Bono', es: 'Bono' },
  membership: { en: 'Membership', es: 'Membresía' },
  on_account: { en: 'On account', es: 'A cuenta' },
}

export function usePaymentPurpose() {
  const t = useT()
  return {
    /**
     * The label for a stored purpose, or '' when there is nothing to say --
     * which the caller should render as a dash rather than as a guess.
     *
     * An unknown key returns the key itself, the same way labelFor does for a
     * method: a purpose added later and not listed here shows as something
     * rather than vanishing.
     */
    purposeLabelFor: (key: string | null | undefined): string => {
      if (!key) return ''
      const known = LABELS[key]
      return known ? t(known.en, known.es) : key
    },
  }
}
