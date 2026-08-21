// Fire-and-forget: called right after the action that triggered it already
// succeeded (a patient checked in, an appointment completed), so a failed
// automation should never surface as an error on that action.
export function useAutomations() {
  function fire(triggerEvent: string, params: { patientId: string; appointmentId?: string; invoiceId?: string }) {
    $fetch('/api/automations/fire', { method: 'POST', body: { triggerEvent, ...params } }).catch(() => {})
  }
  return { fire }
}
