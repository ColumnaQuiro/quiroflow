// Fire-and-forget: called right after the action that triggered it already
// succeeded (a patient checked in, an appointment completed), so a failed
// automation should never surface as an error on that action.
//
// useStaffFetch, not plain $fetch: this hits a requireTeamMember-guarded
// route, and a plain $fetch relies entirely on the session cookie -- which
// the mobile app never has, so every automation trigger fired from mobile
// (check-in, completing a visit, taking a payment) was silently swallowed
// by the catch below with nothing ever actually firing.
export function useAutomations() {
  function fire(triggerEvent: string, params: { patientId: string; appointmentId?: string; invoiceId?: string; membershipId?: string }) {
    useStaffFetch('/api/automations/fire', { method: 'POST', body: { triggerEvent, ...params } }).catch(() => {})
  }
  return { fire }
}
