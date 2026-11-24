import type { AudienceRef } from '~/utils/automationAudience'

// Who a one-off send should go to, on its way from a selection on the
// Patients page to the builder at /automations/new?kind=broadcast&from=patients,
// which takes it once (pages/automations/[id].vue). Either patients chosen
// one by one, or the list or segment the page was showing when everyone in
// it was selected -- so that send stays aimed at whoever is in it when it
// goes. Client state only: nothing is saved until the builder's own Save.
export type BroadcastRecipients = { patientIds: string[] } | { audience: AudienceRef }

export function useBroadcastRecipients() {
  return useState<BroadcastRecipients | null>('broadcast-recipients', () => null)
}
