// A configured method's key (see usePaymentMethods) or 'credit', which is not
// a configured method -- it spends the patient's own balance. Once methods
// became configurable per account a literal union stopped being able to name
// them: a clinic may have 'bizum', 'transfer', or something it added itself.
export type SplitPaymentMethod = string

export interface SplitPaymentRow {
  method: SplitPaymentMethod
  amount: string
}

// Shared row-management for "take a payment" forms that need to split one
// payment across methods (a patient paying part cash, part card) -- used by
// components/patients/BillingTab.vue's takePayment() and
// components/calendar/AppointmentBillingTab.vue's recordPayment(), which are
// otherwise independent implementations. Only the row list itself is shared;
// each caller still does its own submit (payments insert, credit ledger
// entry, paid-status side effects), since those differ between the two
// (recordPayment() also completes the appointment and fires automation
// events).
export function useSplitPayment(defaultMethod: SplitPaymentMethod = 'cash', options: Ref<string[]> = ref([])) {
  const rows = ref<SplitPaymentRow[]>([{ method: defaultMethod, amount: '' }])

  // Back to a single row -- called when opening the form fresh (e.g. for a
  // newly-selected invoice), not when the owner is actively splitting one.
  function reset(amount = '', method: SplitPaymentMethod = defaultMethod) {
    rows.value = [{ method, amount }]
  }

  function addRow() {
    // Splitting means a second method, so default to one not already in the
    // form rather than making the owner touch the picker twice. The list is
    // the account's own now, so this can no longer assume cash and card.
    const used = new Set(rows.value.map((r) => r.method))
    const next = options.value.find((key) => !used.has(key)) ?? defaultMethod
    rows.value.push({ method: next, amount: '' })
  }

  function removeRow(index: number) {
    rows.value.splice(index, 1)
  }

  function centsOf(row: SplitPaymentRow) {
    return Math.round((parseFloat(row.amount) || 0) * 100)
  }

  const totalCents = computed(() => rows.value.reduce((sum, r) => sum + centsOf(r), 0))

  const creditCents = computed(() => rows.value.filter((r) => r.method === 'credit').reduce((sum, r) => sum + centsOf(r), 0))

  return { rows, reset, addRow, removeRow, centsOf, totalCents, creditCents }
}
