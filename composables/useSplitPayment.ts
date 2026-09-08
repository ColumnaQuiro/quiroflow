export type SplitPaymentMethod = 'card' | 'cash' | 'credit'

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
export function useSplitPayment(defaultMethod: SplitPaymentMethod = 'cash') {
  const rows = ref<SplitPaymentRow[]>([{ method: defaultMethod, amount: '' }])

  // Back to a single row -- called when opening the form fresh (e.g. for a
  // newly-selected invoice), not when the owner is actively splitting one.
  function reset(amount = '', method: SplitPaymentMethod = defaultMethod) {
    rows.value = [{ method, amount }]
  }

  function addRow() {
    // Cash+card is the actual case this exists for, so default the new row
    // to whichever of those isn't already in use rather than making the
    // owner touch the method picker twice.
    const used = new Set(rows.value.map((r) => r.method))
    const next: SplitPaymentMethod = used.has('cash') ? 'card' : 'cash'
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
